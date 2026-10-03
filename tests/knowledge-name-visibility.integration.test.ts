import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { buildCreateKnowledgeNode } from "@/application/knowledge/create-knowledge-node";
import { buildAuthorizeKnowledgeSource } from "@/application/knowledge/authorize-knowledge-source";
import { createKnowledgeEdge, createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { createDatabase } from "@/infrastructure/database/client";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createDocumentScopeChangeRepository } from "@/infrastructure/database/repositories/document-scope-change-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";

const hiddenName = "ConfidentialIdentity";
const visibleName = "PublicAlias";

describe("knowledge names follow visible provenance", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(hide: "archive" | "scope restriction") {
    const { pool, db } = database;
    const organizationId = randomUUID(), ownerId = randomUUID(), readerId = randomUUID();
    const now = new Date();
    const scope = { kind: "organization" as const, organizationId };
    const owner: OrganizationAccess = { organizationId, userId: ownerId, role: "owner", teams: [] };
    const reader: OrganizationAccess = { organizationId, userId: readerId, role: "admin", teams: [] };
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'Name provenance')", [organizationId, organizationId]);
    for (const access of [owner, reader]) {
      await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Reviewer')", [access.userId, `${access.userId}@example.test`]);
      await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,$3,'active')", [organizationId, access.userId, access.role]);
    }
    async function document(content: string) {
      const id = randomUUID(), chunkId = randomUUID();
      await pool.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by,created_at,updated_at) VALUES($1,$2,'organization','Names','fixture','checksum','text/plain','ready',$3,$4,$4)", [id, organizationId, ownerId, now]);
      await pool.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,$4)", [chunkId, organizationId, id, content]);
      return { id, chunkId };
    }
    const confidential = await document(hiddenName);
    const publicDocument = await document(`${visibleName} uses Beacon.`);
    const graph = createKnowledgeGraphRepository(db, () => now);
    const node = (canonicalName: string, chunkId: string) => graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope, kind: "service", canonicalName, source: { chunkId }, now
    }), owner);
    const target = await node(hiddenName, confidential.chunkId);
    const alias = await node(visibleName, publicDocument.chunkId);
    const beacon = await node("Beacon", publicDocument.chunkId);
    const merged = await graph.mergeNodes({ organizationId, sourceNodeId: alias.id, targetNodeId: target.id,
      mergedBy: ownerId, reason: "Verified identity", now });
    expect(merged?.id).toBe(target.id);
    await graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId, scope,
      sourceNodeId: target.id, targetNodeId: beacon.id, predicate: "uses", source: { chunkId: publicDocument.chunkId }, now }), owner);
    if (hide === "archive") {
      expect(await createDocumentRepository(db).archive(organizationId, confidential.id, now, scope)).toBe(true);
    } else {
      const changed = await createDocumentScopeChangeRepository(db).changeScope({ access: owner,
        documentId: confidential.id, scope: { kind: "user", organizationId, userId: ownerId },
        expectedUpdatedAt: now.toISOString(), now });
      expect(changed).toMatchObject({ status: "changed", knowledge: { nodes: { skipped: 1 } } });
    }
    return { graph, target, reader, scope, publicDocument, now, document };
  }

  it.each(["archive", "scope restriction"] as const)("hides stored canonical names from reads and matching after %s", async (hide) => {
    const f = await fixture(hide);
    const named = await f.graph.findNodesByNames(f.reader, f.scope, [visibleName]);
    expect.soft(named).toMatchObject([{ id: f.target.id, canonicalName: visibleName, aliases: [] }]);
    expect.soft(await f.graph.findNodesByNames(f.reader, f.scope, [hiddenName])).toEqual([]);
    expect.soft(await f.graph.searchNodes({ access: f.reader, query: hiddenName, limit: 10 })).toEqual([]);
    const search = await f.graph.searchNodes({ access: f.reader, query: visibleName, limit: 10 });
    expect.soft(search).toMatchObject([{ node: { id: f.target.id, canonicalName: visibleName, aliases: [] } }]);
    const neighborhood = await f.graph.findNeighborhood(f.reader, f.target.id, 1, 10);
    expect.soft(neighborhood.nodes.find((node) => node.id === f.target.id))
      .toMatchObject({ canonicalName: visibleName, aliases: [] });
    expect.soft(JSON.stringify(neighborhood)).not.toContain(hiddenName);
  });

  it.each(["archive", "scope restriction"] as const)("keeps the existing identity without copying hidden names into new contributions after %s", async (hide) => {
    const f = await fixture(hide);
    const saved = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope,
      kind: "service", canonicalName: visibleName, source: { chunkId: f.publicDocument.chunkId }, now: f.now }), f.reader);
    expect.soft(saved.id).toBe(f.target.id);
    expect.soft(saved).toMatchObject({ canonicalName: visibleName, aliases: [] });
    expect.soft(await f.graph.findNodesByNames(f.reader, f.scope, [hiddenName])).toEqual([]);
    expect.soft(await f.graph.searchNodes({ access: f.reader, query: hiddenName, limit: 10 })).toEqual([]);
  });

  it.each(["archive", "scope restriction"] as const)("preserves visible candidate names and existing node identity after %s", async (hide) => {
    const f = await fixture(hide);
    const candidates = createKnowledgeCandidateRepository(database.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope,
      documentId: f.publicDocument.id, chunkId: f.publicDocument.chunkId, model: "test", now: f.now,
      graph: { entities: [{ key: "public", canonicalName: visibleName, kind: "service" }], relationships: [] } }));
    const result = await candidates.accept({ candidateId: candidate.id, organizationId: f.scope.organizationId,
      entityPromotions: [{ key: "public", id: randomUUID() }], relationshipIds: [], reviewedBy: f.reader.userId, reviewedAt: f.now });
    expect(result).toMatchObject({ status: "promoted", nodes: [{ id: f.target.id, canonicalName: visibleName, aliases: [] }] });
    expect(await f.graph.findNodesByNames(f.reader, f.scope, [hiddenName])).toEqual([]);
    expect(await f.graph.searchNodes({ access: f.reader, query: hiddenName, limit: 10 })).toEqual([]);
    const stored = (await database.pool.query("SELECT canonical_name FROM knowledge_nodes WHERE id=$1", [f.target.id])).rows[0];
    expect(stored.canonical_name).toBe(hiddenName);
  });

  it("moves each source's names during a later merge without copying its hidden representative", async () => {
    const f = await fixture("scope restriction");
    const destination = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope,
      kind: "service", canonicalName: "Destination", source: { chunkId: f.publicDocument.chunkId }, now: f.now }), f.reader);
    const merged = await f.graph.mergeNodes({ organizationId: f.scope.organizationId, sourceNodeId: f.target.id,
      targetNodeId: destination.id, mergedBy: f.reader.userId, reason: "Verified identity", now: f.now });
    expect(merged).toMatchObject({ canonicalName: "Destination", aliases: [visibleName] });
    expect(await f.graph.findNodesByNames(f.reader, f.scope, [hiddenName])).toEqual([]);
    expect(await f.graph.searchNodes({ access: f.reader, query: hiddenName, limit: 10 })).toEqual([]);
  });

  it("requires a nonempty name map for every persisted node source", async () => {
    const f = await fixture("archive");
    await expect(database.pool.query("UPDATE knowledge_node_sources SET names='{}' WHERE node_id=$1", [f.target.id]))
      .rejects.toMatchObject({ code: "23514", constraint: "knowledge_node_sources_names_nonempty_check" });
    for (const keys of [[], ["missing"]]) {
      await expect(database.pool.query("UPDATE knowledge_node_sources SET primary_name_keys=$2 WHERE node_id=$1", [f.target.id, keys]))
        .rejects.toMatchObject({ code: "23514", constraint: "knowledge_node_sources_primary_names_check" });
    }
  });

  it("does not link a new manual contribution by a hidden stored name", async () => {
    const f = await fixture("scope restriction");
    const source = await f.document(hiddenName);
    const create = buildCreateKnowledgeNode({ clock: () => f.now, generateId: randomUUID,
      repository: f.graph, ontologyReader: createKnowledgeOntologyReader(database.db),
      authorizeSource: buildAuthorizeKnowledgeSource({ clock: () => f.now,
        documentRepository: createDocumentRepository(database.db), memoryRepository: createMemoryRepository(database.db) }) });
    const result = await create({ access: f.reader, scope: f.scope, kind: "service", canonicalName: hiddenName,
      source: { chunkId: source.chunkId } });
    expect.soft(result.node.id).not.toBe(f.target.id);
    expect.soft(result.node.aliases).toEqual([]);
    expect.soft(result.node.sources).toEqual([{ chunkId: source.chunkId }]);
    expect.soft((await f.graph.findNodesByNames(f.reader, f.scope, [visibleName])).map((node) => node.id)).toEqual([f.target.id]);
  });

  it("does not link a new candidate contribution by a hidden stored name", async () => {
    const f = await fixture("scope restriction");
    const source = await f.document(hiddenName);
    const candidates = createKnowledgeCandidateRepository(database.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope,
      documentId: source.id, chunkId: source.chunkId, model: "test", now: f.now,
      graph: { entities: [{ key: "new", canonicalName: hiddenName, kind: "service" }], relationships: [] } }));
    const result = await candidates.accept({ candidateId: candidate.id, organizationId: f.scope.organizationId,
      entityPromotions: [{ key: "new", id: randomUUID() }], relationshipIds: [], reviewedBy: f.reader.userId, reviewedAt: f.now });
    expect(result.status).toBe("promoted");
    if (result.status !== "promoted") throw new Error("expected a promoted candidate");
    expect.soft(result.nodes[0]?.id).not.toBe(f.target.id);
    expect.soft(result.nodes[0]?.aliases).toEqual([]);
    expect.soft(result.nodes[0]?.sources).toEqual([{ chunkId: source.chunkId }]);
    const replay = await candidates.accept({ candidateId: candidate.id, organizationId: f.scope.organizationId,
      entityPromotions: [], relationshipIds: [], reviewedBy: f.reader.userId, reviewedAt: f.now });
    expect(replay).toMatchObject({ status: "promoted", nodes: [{ id: result.nodes[0]!.id }] });
  });

  it("deduplicates concurrent visible contributions without using the hidden stored label", async () => {
    const f = await fixture("scope restriction");
    const sources = await Promise.all([f.document(hiddenName), f.document(hiddenName)]);
    const saved = await Promise.all(sources.map((source) => f.graph.saveNode(createKnowledgeNode({
      id: randomUUID(), scope: f.scope, kind: "service", canonicalName: hiddenName,
      source: { chunkId: source.chunkId }, now: f.now
    }), f.reader)));
    expect(saved[0]?.id).not.toBe(f.target.id);
    expect(saved[0]?.id).toBe(saved[1]?.id);
    const found = await f.graph.findNodesByNames(f.reader, f.scope, [hiddenName]);
    expect(found).toHaveLength(1);
    expect(found[0]?.sources).toHaveLength(2);
  });

  it("does not treat a hidden stored label as a document scope identity conflict", async () => {
    const f = await fixture("scope restriction");
    const source = await f.document(hiddenName);
    const scopes = createDocumentScopeChangeRepository(database.db);
    const personalScope = { kind: "user" as const, organizationId: f.scope.organizationId, userId: f.reader.userId };
    const personal = await scopes.changeScope({ access: f.reader, documentId: source.id, scope: personalScope,
      expectedUpdatedAt: f.now.toISOString(), now: f.now });
    if (personal.status !== "changed") throw new Error("expected personal document scope");
    const node = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: personalScope,
      kind: "service", canonicalName: hiddenName, source: { chunkId: source.chunkId }, now: f.now }), f.reader);
    const shared = await scopes.changeScope({ access: f.reader, documentId: source.id, scope: f.scope,
      expectedUpdatedAt: personal.document.updatedAt.toISOString(), now: f.now });
    expect(shared).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1, skipped: 0 } } });
    expect((await f.graph.findNodesByNames(f.reader, f.scope, [hiddenName])).map((value) => value.id)).toEqual([node.id]);
  });

  it("keeps original representative-name roles when two visible display labels become the same alias", async () => {
    const f = await fixture("scope restriction");
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "service", canonicalName: visibleName,
      aliases: ["Alias"], source: { chunkId: f.publicDocument.chunkId }, now: f.now }), f.reader);
    const original = await f.document("OtherConfidentialIdentity");
    const visible = await f.document("Visible2 is also called Alias.");
    const hidden = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "service",
      canonicalName: "OtherConfidentialIdentity", source: { chunkId: original.chunkId }, now: f.now }), f.reader);
    const named = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "service",
      canonicalName: "Visible2", aliases: ["Alias"], source: { chunkId: visible.chunkId }, now: f.now }), f.reader);
    await f.graph.mergeNodes({ organizationId: f.scope.organizationId, sourceNodeId: named.id, targetNodeId: hidden.id,
      mergedBy: f.reader.userId, reason: "Verified identity", now: f.now });
    await createDocumentRepository(database.db).archive(f.scope.organizationId, original.id, f.now, f.scope);
    const existing = await f.graph.findNodesByNames(f.reader, f.scope, ["Alias"]);
    expect(existing.map((node) => node.canonicalName)).toEqual(["Alias", "Alias"]);
    expect(existing.map((node) => node.primaryNames[0]).sort()).toEqual([visibleName, "Visible2"].sort());

    const source = await f.document("NewPerson is also called Alias.");
    const candidates = createKnowledgeCandidateRepository(database.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope,
      documentId: source.id, chunkId: source.chunkId, model: "test", now: f.now,
      graph: { entities: [{ key: "new", canonicalName: "NewPerson", aliases: ["Alias"], kind: "service" }], relationships: [] } }));
    const result = await candidates.accept({ candidateId: candidate.id, organizationId: f.scope.organizationId,
      entityPromotions: [{ key: "new", id: randomUUID() }], relationshipIds: [], reviewedBy: f.reader.userId, reviewedAt: f.now });
    expect(result.status).toBe("promoted");
    expect(await f.graph.findNodeById(f.scope.organizationId, f.target.id)).not.toBeNull();
    expect(await f.graph.findNodeById(f.scope.organizationId, hidden.id)).not.toBeNull();
    expect(await f.graph.findNodesByNames(f.reader, f.scope, ["Alias"])).toHaveLength(3);
  });
});
