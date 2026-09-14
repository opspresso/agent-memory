import { eq, sql } from "drizzle-orm";
import type { AgentMemoryDatabase } from "../client";
import { knowledgeEdges, knowledgeGraphVersions, knowledgeNodes } from "../schema";
import { KnowledgeGraphUnavailableError, type KnowledgeTopologyReader, type KnowledgeTopologyStore } from "@/domain/knowledge/knowledge-topology";

/** PostgreSQL is the approval ledger; Neo4j is its durable topology projection. */
export function createKnowledgeGraphProjection(db: AgentMemoryDatabase, store: KnowledgeTopologyStore): KnowledgeTopologyReader {
  return {
    async prepare(organizationId) {
      try {
        const [current] = await db.select().from(knowledgeGraphVersions).where(eq(knowledgeGraphVersions.organizationId, organizationId));
        if (current && await store.revision(organizationId) === current.revision) return;
        await db.transaction(async (transaction) => {
          await transaction.execute(sql`SET LOCAL lock_timeout = '10s'`);
          // Serialize snapshots with every graph writer. Do not call the writer
          // helper: projecting a revision must not itself create a new revision.
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge-scope:${organizationId}`}, 0))`);
          await transaction.insert(knowledgeGraphVersions).values({ organizationId }).onConflictDoNothing();
          const [version] = await transaction.select().from(knowledgeGraphVersions).where(eq(knowledgeGraphVersions.organizationId, organizationId));
          if (!version) throw new Error("knowledge graph revision is missing");
          if (await store.revision(organizationId) === version.revision) return;
          const nodes = await transaction.select({ id: knowledgeNodes.id, kind: knowledgeNodes.kind, canonicalName: knowledgeNodes.canonicalName })
            .from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, organizationId));
          const edges = await transaction.select({ id: knowledgeEdges.id, sourceNodeId: knowledgeEdges.sourceNodeId,
            targetNodeId: knowledgeEdges.targetNodeId, predicate: knowledgeEdges.predicate })
            .from(knowledgeEdges).where(eq(knowledgeEdges.organizationId, organizationId));
          await store.replace({ organizationId, revision: version.revision, nodes, edges });
        });
      } catch (cause) {
        throw new KnowledgeGraphUnavailableError({ cause });
      }
    },
    incidentEdgeIds: (...arguments_) => store.incidentEdgeIds(...arguments_)
  };
}
