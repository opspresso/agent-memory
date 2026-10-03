import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createKnowledgeEdge, createKnowledgeNode, type KnowledgeSource } from "@/domain/knowledge/knowledge-graph";
import { createMemory } from "@/domain/memory/memory";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { buildAcceptKnowledgeCandidate } from "@/application/knowledge/review-knowledge-candidate";
import { createDatabase } from "@/infrastructure/database/client";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";

const unavailableSources = ["document archive", "memory archive", "memory expiry", "memory future"] as const;
const visibleProperties = { visibleOnly: "public source fact", shared: "from visible source" };
const laterProperties = { hiddenOnly: "unavailable source fact", shared: "from later source" };

describe("knowledge properties retain their provenance", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
  });

  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  async function fixture(unavailableSource: typeof unavailableSources[number]) {
    const { pool, db } = database;
    const organizationId = randomUUID(), userId = randomUUID();
    const documentId = randomUUID(), chunkId = randomUUID(), unavailableId = randomUUID();
    const now = new Date();
    const firstAt = new Date(now.getTime() - 2_000), laterAt = new Date(now.getTime() - 1_000);
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'Property provenance')", [organizationId, organizationId]);
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Reviewer')", [userId, `${userId}@example.test`]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId, userId]);
    await pool.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization','Visible source','fixture','checksum','text/plain','ready',$3)", [documentId, organizationId, userId]);
    await pool.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,'Atlas uses Beacon.')", [chunkId, organizationId, documentId]);
    const scope = { kind: "organization" as const, organizationId };
    const access: OrganizationAccess = { organizationId, userId, role: "owner", teams: [] };
    const visibleSource: KnowledgeSource = { chunkId };
    let laterSource: KnowledgeSource;
    if (unavailableSource === "document archive") {
      const unavailableChunkId = randomUUID();
      await pool.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization','Later source','fixture','checksum','text/plain','ready',$3)", [unavailableId, organizationId, userId]);
      await pool.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,'Atlas uses Beacon in a sensitive project.')", [unavailableChunkId, organizationId, unavailableId]);
      laterSource = { chunkId: unavailableChunkId };
    } else {
      await createMemoryRepository(db).save(createMemory({
        id: unavailableId, kind: "fact", scope, title: "Later source", content: "Atlas uses Beacon in a sensitive project.",
        source: { type: "user" }, createdBy: userId, validFrom: new Date(now.getTime() - 60_000), now: firstAt
      }));
      laterSource = { memoryId: unavailableId };
    }
    async function makeUnavailable() {
      if (unavailableSource === "document archive") {
        await pool.query("UPDATE documents SET status='archived' WHERE id=$1", [unavailableId]);
      } else if (unavailableSource === "memory archive") {
        await pool.query("UPDATE memories SET status='archived' WHERE id=$1", [unavailableId]);
      } else if (unavailableSource === "memory expiry") {
        await pool.query("UPDATE memories SET expires_at=$2 WHERE id=$1", [unavailableId, new Date(now.getTime() - 1)]);
      } else {
        await pool.query("UPDATE memories SET valid_from=$2 WHERE id=$1", [unavailableId, new Date(now.getTime() + 60_000)]);
      }
    }
    return { organizationId, documentId, scope, access, visibleSource, laterSource, firstAt, laterAt,
      graph: createKnowledgeGraphRepository(db, () => now), makeUnavailable };
  }

  async function writer(f: Awaited<ReturnType<typeof fixture>>, resource: "node" | "edge") {
    if (resource === "node") {
      return (source: KnowledgeSource, properties: Readonly<Record<string, unknown>>, now: Date) => f.graph.saveNode(createKnowledgeNode({
        id: randomUUID(), scope: f.scope, kind: "service", canonicalName: "Atlas", properties, source, now
      }), f.access);
    }
    const [atlas, beacon] = await Promise.all(["Atlas", "Beacon"].map((canonicalName) => f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName, source: f.visibleSource, now: f.firstAt
    }), f.access)));
    return (source: KnowledgeSource, properties: Readonly<Record<string, unknown>>, now: Date) => f.graph.saveEdge(createKnowledgeEdge({
      id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: atlas!.id, targetNodeId: beacon!.id,
      predicate: "uses", properties, source, now
    }), f.access);
  }

  it.each(["node", "edge"] as const)("replaces each %s source snapshot and filters unavailable properties from write responses", async (resource) => {
    const f = await fixture("memory archive");
    const write = await writer(f, resource);
    const original = await write(f.visibleSource, visibleProperties, f.firstAt);
    await write(f.laterSource, laterProperties, f.laterAt);
    const replacement = { replacementOnly: true, shared: "updated visible source" };
    const updated = await write(f.visibleSource, replacement, new Date(f.laterAt.getTime() + 1));
    expect(updated.id).toBe(original.id);
    expect(updated.properties).toEqual({ ...laterProperties, ...replacement });
    expect(updated.properties).not.toHaveProperty("visibleOnly");

    await f.makeUnavailable();

    const visible = await write(f.visibleSource, replacement, new Date(f.laterAt.getTime() + 2));
    expect(visible.properties).toEqual(replacement);
    expect(visible.sources).toEqual([f.visibleSource]);
    expect((await write(f.visibleSource, {}, new Date(f.laterAt.getTime() + 3))).properties).toEqual({});
    const table = resource === "node" ? "knowledge_node_sources" : "knowledge_edge_sources";
    const column = resource === "node" ? "node_id" : "edge_id";
    await expect(database.pool.query(`UPDATE ${table} SET properties='[]'::jsonb WHERE ${column}=$1`, [original.id]))
      .rejects.toMatchObject({ code: "23514", constraint: `${table}_properties_object_check` });
  });

  it.each(["node", "edge"] as const)("preserves %s property provenance during merges and prefers the target on duplicate sources", async (resource) => {
    const f = await fixture("memory archive");
    const node = (canonicalName: string, source: KnowledgeSource, properties: Readonly<Record<string, unknown>>, now: Date) => f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName, properties, source, now
    }), f.access);
    const targetProperties = { targetOnly: true, shared: "target" };
    const sourceProperties = { sourceOnly: true, shared: "source" };
    const distinctProperties = { distinctOnly: true, shared: "distinct source" };
    const target = await node("Atlas", f.visibleSource, resource === "node" ? targetProperties : {}, f.firstAt);
    const source = await node("Atlas alias", f.visibleSource, resource === "node" ? sourceProperties : {}, f.laterAt);
    let targetId = target.id;
    if (resource === "node") {
      await node("Atlas alias", f.laterSource, distinctProperties, f.laterAt);
    } else {
      const endpoint = await node("Beacon", f.visibleSource, {}, f.firstAt);
      const edge = (sourceNodeId: string, source: KnowledgeSource, properties: Readonly<Record<string, unknown>>, now: Date) => f.graph.saveEdge(createKnowledgeEdge({
        id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId, targetNodeId: endpoint.id,
        predicate: "uses", properties, source, now
      }), f.access);
      targetId = (await edge(target.id, f.visibleSource, targetProperties, f.firstAt)).id;
      await edge(source.id, f.visibleSource, sourceProperties, f.laterAt);
      await edge(source.id, f.laterSource, distinctProperties, f.laterAt);
    }
    const mergedAt = new Date(f.laterAt.getTime() + 100);
    const merged = await f.graph.mergeNodes({ organizationId: f.organizationId, sourceNodeId: source.id, targetNodeId: target.id,
      mergedBy: f.access.userId, reason: "Verified shared identity", now: mergedAt });
    const result = resource === "node" ? merged : (await f.graph.findNeighborhood(f.access, target.id, 1, 10)).edges.find((edge) => edge.id === targetId);
    expect(result?.properties).toEqual({ ...distinctProperties, ...sourceProperties, ...targetProperties });
    expect(result?.sources).toEqual(expect.arrayContaining([f.visibleSource, f.laterSource]));
    const table = resource === "node" ? "knowledge_node_sources" : "knowledge_edge_sources";
    const column = resource === "node" ? "node_id" : "edge_id";
    const rows = (await database.pool.query(`SELECT memory_id, chunk_id, properties, updated_at FROM ${table} WHERE ${column}=$1`, [targetId])).rows;
    expect(rows).toEqual(expect.arrayContaining([
      { memory_id: null, chunk_id: f.visibleSource.chunkId, properties: { ...sourceProperties, ...targetProperties }, updated_at: mergedAt },
      { memory_id: f.laterSource.memoryId, chunk_id: null, properties: distinctProperties, updated_at: f.laterAt }
    ]));
    expect(rows).toHaveLength(2);
  });

  it.each([false, true])("preserves an approved endpoint snapshot when accepting its remaining relationship (merged: %s)", async (mergeEndpoint) => {
    const f = await fixture("memory archive");
    const candidates = createKnowledgeCandidateRepository(database.db);
    const candidate = await candidates.save(createKnowledgeCandidate({
      id: randomUUID(), scope: f.scope, documentId: f.documentId, chunkId: f.visibleSource.chunkId!, model: "extractor",
      graph: { entities: ["Atlas", "Beacon"].map((canonicalName) => ({ key: canonicalName, canonicalName, kind: "service", summary: "Extracted description" })),
        relationships: [{ sourceKey: "Atlas", targetKey: "Beacon", predicate: "uses" }] }, now: f.firstAt
    }));
    let reviewedAt = f.firstAt;
    const accept = buildAcceptKnowledgeCandidate({ repository: candidates, ontologyReader: createKnowledgeOntologyReader(database.db),
      clock: () => reviewedAt, generateId: randomUUID });
    const first = await accept(f.access, candidate.id, undefined, { entityKeys: ["Atlas", "Beacon"], relationshipIndexes: [] });
    const original = first.nodes.find((node) => node.canonicalName === "Atlas")!;
    const curated = await f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName: mergeEndpoint ? "Primary Atlas" : "Atlas",
      properties: { annotation: "Human reviewed" }, summary: "Manually curated description", embedding: { model: "curated-vector", values: [0, 1] },
      source: f.visibleSource, now: f.laterAt
    }), f.access);
    if (mergeEndpoint) {
      await f.graph.mergeNodes({ organizationId: f.organizationId, sourceNodeId: original.id, targetNodeId: curated.id,
        mergedBy: f.access.userId, reason: "Verified name", now: new Date(f.laterAt.getTime() + 1) });
    }
    const sourceSnapshot = () => database.pool.query("SELECT properties, description, embedding::text, embedding_model, updated_at FROM knowledge_node_sources WHERE node_id=$1 AND chunk_id=$2", [curated.id, f.visibleSource.chunkId]);
    const before = (await sourceSnapshot()).rows;
    reviewedAt = new Date(f.laterAt.getTime() + 500);

    const approved = await accept(f.access, candidate.id, undefined, { entityKeys: [], relationshipIndexes: [0] });

    expect((await sourceSnapshot()).rows).toEqual(before);
    expect(approved.nodes.find((node) => node.id === curated.id)?.properties).toEqual({ annotation: "Human reviewed" });
    expect(approved.edges).toMatchObject([{ sourceNodeId: curated.id, predicate: "uses" }]);
  });

  it.each(["node", "edge"] as const)("preserves manually supplied %s properties and their precedence during first candidate approval", async (resource) => {
    const f = await fixture("memory archive");
    const write = await writer(f, resource);
    const manual = await write(f.visibleSource, visibleProperties, f.firstAt);
    await write(f.laterSource, laterProperties, f.laterAt);
    const table = resource === "node" ? "knowledge_node_sources" : "knowledge_edge_sources";
    const column = resource === "node" ? "node_id" : "edge_id";
    const snapshots = () => database.pool.query(`SELECT properties, updated_at FROM ${table} WHERE ${column}=$1 AND chunk_id=$2`, [manual.id, f.visibleSource.chunkId]);
    const before = (await snapshots()).rows;
    const candidates = createKnowledgeCandidateRepository(database.db);
    const candidate = await candidates.save(createKnowledgeCandidate({
      id: randomUUID(), scope: f.scope, documentId: f.documentId, chunkId: f.visibleSource.chunkId!, model: "extractor",
      graph: { entities: ["Atlas", "Beacon"].map((canonicalName) => ({ key: canonicalName, canonicalName, kind: "service" })),
        relationships: [{ sourceKey: "Atlas", targetKey: "Beacon", predicate: "uses" }] }, now: f.firstAt
    }));
    const accept = buildAcceptKnowledgeCandidate({ repository: candidates, ontologyReader: createKnowledgeOntologyReader(database.db),
      clock: () => new Date(f.laterAt.getTime() + 500), generateId: randomUUID });

    const approved = await accept(f.access, candidate.id);

    expect((await snapshots()).rows).toEqual(before);
    const result = resource === "node" ? approved.nodes.find((node) => node.id === manual.id) : approved.edges.find((edge) => edge.id === manual.id);
    expect(result?.properties).toEqual({ ...visibleProperties, ...laterProperties });
    expect(result?.sources).toEqual(expect.arrayContaining([f.visibleSource, f.laterSource]));
  });

  it.each(unavailableSources)("removes node properties whose only source became unavailable after %s", async (unavailableSource) => {
    const f = await fixture(unavailableSource);
    const node = await f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName: "Atlas", properties: visibleProperties,
      source: f.visibleSource, now: f.firstAt
    }), f.access);
    const updated = await f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName: "Atlas", properties: laterProperties,
      source: f.laterSource, now: f.laterAt
    }), f.access);
    expect(updated.id).toBe(node.id);
    expect(updated.properties).toEqual({ ...visibleProperties, ...laterProperties });

    await f.makeUnavailable();

    const named = await f.graph.findNodesByNames(f.access, f.scope, ["Atlas"]);
    expect(named).toMatchObject([{ id: node.id, sources: [f.visibleSource], properties: visibleProperties }]);
    expect(named[0]?.properties).toEqual(visibleProperties);
    const hits = await f.graph.searchNodes({ access: f.access, query: "Atlas", limit: 10 });
    expect(hits[0]?.node.properties).toEqual(visibleProperties);
    const neighborhood = await f.graph.findNeighborhood(f.access, node.id, 1, 10);
    expect(neighborhood.nodes[0]?.properties).toEqual(visibleProperties);
  });

  it.each(unavailableSources)("removes edge properties whose only source became unavailable after %s", async (unavailableSource) => {
    const f = await fixture(unavailableSource);
    const [atlas, beacon] = await Promise.all(["Atlas", "Beacon"].map((canonicalName) => f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName, source: f.visibleSource, now: f.firstAt
    }), f.access)));
    const edge = await f.graph.saveEdge(createKnowledgeEdge({
      id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: atlas!.id, targetNodeId: beacon!.id,
      predicate: "uses", properties: visibleProperties, source: f.visibleSource, now: f.firstAt
    }), f.access);
    const updated = await f.graph.saveEdge(createKnowledgeEdge({
      id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: atlas!.id, targetNodeId: beacon!.id,
      predicate: "uses", properties: laterProperties, source: f.laterSource, now: f.laterAt
    }), f.access);
    expect(updated.id).toBe(edge.id);
    expect(updated.properties).toEqual({ ...visibleProperties, ...laterProperties });

    await f.makeUnavailable();

    const neighborhood = await f.graph.findNeighborhood(f.access, atlas!.id, 1, 10);
    expect(neighborhood.edges).toMatchObject([{ id: edge.id, sources: [f.visibleSource], properties: visibleProperties }]);
    expect(neighborhood.edges[0]?.properties).toEqual(visibleProperties);
  });
});
