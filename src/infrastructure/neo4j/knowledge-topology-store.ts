import neo4j, { type Driver } from "neo4j-driver";
import { KnowledgeGraphUnavailableError, type KnowledgeTopologySnapshot, type KnowledgeTopologyStore } from "@/domain/knowledge/knowledge-topology";

const batchSize = 1_000;

export function createNeo4jKnowledgeTopologyStore(driver: Driver, database: string): KnowledgeTopologyStore & { initialize(): Promise<void> } {
  return {
    async initialize() {
      for (const query of [
        "CREATE CONSTRAINT memory_graph_identity IF NOT EXISTS FOR (g:MemoryGraph) REQUIRE g.organizationId IS UNIQUE",
        "CREATE CONSTRAINT memory_entity_identity IF NOT EXISTS FOR (n:MemoryEntity) REQUIRE (n.organizationId, n.id) IS UNIQUE"
      ]) await driver.executeQuery(query, {}, { database });
    },
    async revision(organizationId) {
      const { records } = await driver.executeQuery("MATCH (g:MemoryGraph {organizationId: $organizationId}) RETURN g.revision AS revision",
        { organizationId }, { database, routing: "READ" });
      const value: unknown = records[0]?.get("revision");
      return typeof value === "string" ? value : undefined;
    },
    async replace(snapshot: KnowledgeTopologySnapshot) {
      const session = driver.session({ database, bookmarkManager: driver.executeQueryBookmarkManager });
      try {
        await session.executeWrite(async (transaction) => {
          const parameters = { organizationId: snapshot.organizationId };
          // All replacement statements commit together; readers cannot observe
          // a half-written graph and a failed projection leaves the old one intact.
          await transaction.run("MATCH (n:MemoryEntity {organizationId: $organizationId}) DETACH DELETE n", parameters);
          for (let start = 0; start < snapshot.nodes.length; start += batchSize) {
            await transaction.run(`UNWIND $nodes AS node
              CREATE (:MemoryEntity {organizationId: $organizationId, id: node.id, kind: node.kind, name: node.canonicalName})`,
            { ...parameters, nodes: snapshot.nodes.slice(start, start + batchSize) });
          }
          for (let start = 0; start < snapshot.edges.length; start += batchSize) {
            const batch = snapshot.edges.slice(start, start + batchSize);
            const result = await transaction.run(`UNWIND $edges AS edge
              MATCH (source:MemoryEntity {organizationId: $organizationId, id: edge.sourceNodeId})
              MATCH (target:MemoryEntity {organizationId: $organizationId, id: edge.targetNodeId})
              CREATE (source)-[relation:MEMORY_RELATION {organizationId: $organizationId, id: edge.id, predicate: edge.predicate}]->(target)
              RETURN count(relation) AS created`, { ...parameters, edges: batch });
            const created: unknown = result.records[0]?.get("created");
            if (!neo4j.isInt(created) || created.toNumber() !== batch.length) throw new Error("knowledge graph projection has missing endpoints");
          }
          await transaction.run("MERGE (g:MemoryGraph {organizationId: $organizationId}) SET g.revision = $revision",
            { ...parameters, revision: snapshot.revision });
        }, { timeout: 30_000 });
      } finally {
        await session.close();
      }
    },
    async incidentEdgeIds(organizationId, nodeIds, afterId, limit) {
      try {
        const { records } = await driver.executeQuery(`MATCH (n:MemoryEntity)-[edge:MEMORY_RELATION]-(other:MemoryEntity)
          WHERE n.organizationId = $organizationId AND n.id IN $nodeIds
            AND edge.organizationId = $organizationId AND other.organizationId = $organizationId
            AND ($afterId IS NULL OR edge.id > $afterId)
          RETURN DISTINCT edge.id AS id ORDER BY id LIMIT $limit`,
        { organizationId, nodeIds: [...nodeIds], afterId: afterId ?? null, limit: neo4j.int(limit) }, { database, routing: "READ" });
        return records.map((record) => {
          const value: unknown = record.get("id");
          if (typeof value !== "string") throw new Error("knowledge graph edge ID is invalid");
          return value;
        });
      } catch (cause) {
        throw new KnowledgeGraphUnavailableError({ cause });
      }
    }
  };
}
