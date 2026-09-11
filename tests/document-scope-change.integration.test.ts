import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createDocumentScopeChangeRepository } from "@/infrastructure/database/repositories/document-scope-change-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { documents, documentChunks, documentScopeChanges, organizations, organizationMembers, users, teams, teamMembers, knowledgeNodes, knowledgeEdges } from "@/infrastructure/database/schema";
import { createKnowledgeNode, createKnowledgeEdge } from "@/domain/knowledge/knowledge-graph";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { ScopedResource, OrganizationAccess } from "@/domain/identity/organization-access";
import { KnowledgeScopeChangedError } from "@/domain/knowledge/knowledge-scope-change";
import { createMemory } from "@/domain/memory/memory";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";

describe("document scope transactions", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
  });
  afterAll(async () => { await database?.pool.end(); await container?.stop(); });

  async function fixture() {
    const { db } = database;
    const organizationId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID(), teamId = randomUUID();
    const now = new Date();
    await db.insert(users).values([userId, otherUserId].map((id) => ({ id, name: "Scope test", email: `${id}@example.com`, emailVerified: true })));
    await db.insert(organizations).values({ id: organizationId, slug: organizationId, name: "Scope test" });
    await db.insert(organizationMembers).values([{ organizationId, userId, role: "owner", status: "active" }, { organizationId, userId: otherUserId, role: "member", status: "active" }]);
    await db.insert(teams).values({ id: teamId, organizationId, slug: teamId, name: "Test team" });
    await db.insert(teamMembers).values({ organizationId, teamId, userId: otherUserId, role: "manager" });
    const access: OrganizationAccess = { organizationId, userId, role: "owner", teams: [] };
    const scope: ScopedResource = { kind: "user", organizationId, userId };
    const target: ScopedResource = { kind: "organization", organizationId };
    const graph = createKnowledgeGraphRepository(db);
    const scopeRepository = createDocumentScopeChangeRepository(db);
    async function document(documentScope: ScopedResource = scope, status: "ready" | "processing" | "archived" = "ready") {
      const id = randomUUID(), chunkId = randomUUID();
      const [row] = await db.insert(documents).values({ id, organizationId, scopeKind: documentScope.kind, userId: documentScope.kind === "user" ? documentScope.userId : null, teamId: documentScope.kind === "team" ? documentScope.teamId : null, title: "Three Kingdoms", objectKey: id, checksum: "a".repeat(64), mimeType: "text/plain", status, createdBy: userId, updatedAt: now }).returning();
      await db.insert(documentChunks).values({ id: chunkId, organizationId, documentId: id, ordinal: 0, content: "Liu Bei meets Guan Yu." });
      return { id, chunkId, updatedAt: row!.updatedAt };
    }
    const doc = await document();
    async function node(name: string, chunkId = doc.chunkId, nodeScope: ScopedResource = scope) {
      return graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: nodeScope, kind: "person", canonicalName: name, source: { chunkId }, now }));
    }
    const change = (record = doc, nextScope: ScopedResource = target, actor = access) => scopeRepository.changeScope({ access: actor, documentId: record.id, scope: nextScope, expectedUpdatedAt: record.updatedAt.toISOString(), now });
    return { ...database, organizationId, userId, otherUserId, teamId, now, access, scope, target, doc, document, node, graph, change };
  }

  it("changes the document, verified graph and candidate scope, preserving chunks and provenance", async () => {
    const f = await fixture();
    const a = await f.node("Liu Bei"), b = await f.node("Guan Yu");
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: f.doc.chunkId }, now: f.now }));
    const candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope, documentId: f.doc.id, chunkId: f.doc.chunkId, model: "test", graph: { entities: [], relationships: [] }, now: f.now }));
    const result = await f.change();
    expect(result.status).toBe("changed");
    if (result.status !== "changed") throw new Error(result.status);
    expect(result.knowledge.nodes.updated).toBe(2);
    expect(result.knowledge.edges.updated).toBe(1);
    expect((await f.graph.findNodeById(f.organizationId, a.id))?.scope).toEqual(f.target);
    expect((await f.graph.findEdgeById(f.organizationId, edge.id))?.scope).toEqual(f.target);
    expect((await candidates.findById(f.organizationId, candidate.id))?.scope).toEqual(f.target);
    expect((await createDocumentRepository(f.db).findChunkById(f.organizationId, f.doc.chunkId))?.document.scope).toEqual(f.target);
    const audit = await f.db.select().from(documentScopeChanges).where(eq(documentScopeChanges.documentId, f.doc.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ previousScope: f.scope, scope: f.target, changedBy: f.userId, knowledge: result.knowledge });
    const reader = { ...f.access, role: "member" as const, userId: f.otherUserId };
    expect((await f.graph.searchNodes({ access: reader, query: "Liu", limit: 10 })).map((hit) => hit.node.id)).toContain(a.id);
    expect((await f.graph.findNodeById(f.organizationId, a.id))?.sources).toEqual([{ chunkId: f.doc.chunkId }]);
  });

  it("keeps mixed private provenance and dependent relations private", async () => {
    const f = await fixture();
    const privateDoc = await f.document();
    const a = await f.node("Liu Bei"), b = await f.node("Guan Yu");
    await f.node("Liu Bei", privateDoc.chunkId);
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: f.doc.chunkId }, now: f.now }));
    const result = await f.change();
    expect(result).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1, skipped: 1 }, edges: { updated: 0, skipped: 1 } } });
    expect((await f.graph.findNodeById(f.organizationId, a.id))?.scope).toEqual(f.scope);
    expect((await f.graph.findEdgeById(f.organizationId, edge.id))?.scope).toEqual(f.scope);
    expect((await createDocumentRepository(f.db).findById(f.organizationId, privateDoc.id))?.scope).toEqual(f.scope);
    const reader = { ...f.access, userId: f.otherUserId, role: "member" as const };
    expect(await f.graph.searchNodes({ access: reader, query: "Liu", limit: 10 })).toEqual([]);
    // Once the other source is also shared, the existing node can safely move.
    expect(await f.change(privateDoc)).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1 } } });
  });

  it("skips an identity collision without merging or losing the original node", async () => {
    const f = await fixture();
    const publicDoc = await f.document(f.target);
    const privateNode = await f.node("Liu Bei"), publicNode = await f.node("LIU BEI", publicDoc.chunkId, f.target);
    expect(await f.change()).toMatchObject({ status: "changed", knowledge: { skipped: [{ resource: "node", reason: "identity_conflict", count: 1 }] } });
    expect((await f.graph.findNodeById(f.organizationId, privateNode.id))?.scope).toEqual(f.scope);
    expect((await f.graph.findNodeById(f.organizationId, publicNode.id))?.scope).toEqual(f.target);
  });

  it("allows exactly one concurrent change with the same ETag", async () => {
    const f = await fixture();
    await f.node("Liu Bei");
    const results = await Promise.all([f.change(), f.change()]);
    expect(results.map((result) => result.status).sort()).toEqual(["changed", "conflict"]);
    expect(await f.db.select().from(documentScopeChanges).where(eq(documentScopeChanges.documentId, f.doc.id))).toHaveLength(1);
  });

  it("skips duplicate relations even when only the edge references the changed document", async () => {
    const f = await fixture();
    const publicDoc = await f.document(f.target);
    const a = await f.node("Liu Bei", publicDoc.chunkId, f.target), b = await f.node("Guan Yu", publicDoc.chunkId, f.target);
    for (const [scope, chunkId] of [[f.scope, f.doc.chunkId], [f.target, publicDoc.chunkId]] as const) {
      await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId }, now: f.now }));
    }
    expect(await f.change()).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 0 }, edges: { updated: 0, skipped: 1 }, skipped: [{ resource: "edge", reason: "identity_conflict", count: 1 }] } });
  });

  it.each(["private", "expired", "future"] as const)("does not widen knowledge backed by a %s Memory", async (kind) => {
    const f = await fixture();
    const memoryId = randomUUID();
    const source = createMemory({ id: memoryId, scope: kind === "private" ? f.scope : f.target, kind: "fact", title: "Memory evidence", content: "Liu Bei", source: { type: "user" }, createdBy: f.userId,
      validFrom: new Date(f.now.getTime() + (kind === "future" ? 10000 : -10000)), ...(kind === "expired" ? { expiresAt: new Date(f.now.getTime() - 1) } : {}), now: f.now });
    await createMemoryRepository(f.db).save(source);
    const node = await f.node("Liu Bei");
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person", canonicalName: "Liu Bei", source: { memoryId }, now: f.now }));
    const unrelated = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person", canonicalName: "Unrelated Memory", source: { memoryId }, now: f.now }));
    expect(await f.change()).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 0, skipped: 1 }, skipped: [{ resource: "node", reason: kind === "private" ? "source_scope" : "source_unavailable", count: 1 }] } });
    expect((await f.graph.findNodeById(f.organizationId, node.id))?.scope).toEqual(f.scope);
    expect((await f.graph.findNodeById(f.organizationId, unrelated.id))?.scope).toEqual(f.scope);
    expect((await createMemoryRepository(f.db).findById(f.organizationId, memoryId))?.scope).toEqual(source.scope);
  });

  it("enforces both scopes, active membership, installation boundary and ready state", async () => {
    const f = await fixture();
    const member = { ...f.access, userId: f.otherUserId, role: "member" as const };
    expect(await f.change(f.doc, f.target, member)).toEqual({ status: "not_found" });
    expect(await f.change(f.doc, { kind: "organization", organizationId: randomUUID() })).toEqual({ status: "access_denied" });
    expect(await f.change(f.doc, { kind: "team", organizationId: f.organizationId, teamId: randomUUID() })).toEqual({ status: "invalid_target" });
    expect(await f.change(await f.document(f.scope, "processing"))).toEqual({ status: "not_ready" });
    expect(await f.change(await f.document(f.scope, "archived"))).toEqual({ status: "not_found" });
    await f.db.update(organizationMembers).set({ status: "blocked" }).where(and(eq(organizationMembers.organizationId, f.organizationId), eq(organizationMembers.userId, f.userId)));
    expect(await f.change()).toEqual({ status: "access_denied" });
    expect(await f.db.select().from(documentScopeChanges).where(eq(documentScopeChanges.documentId, f.doc.id))).toEqual([]);
  });

  it("rechecks a candidate reviewer's permission after its document moves", async () => {
    const f = await fixture();
    const doc = await f.document({ kind: "team", organizationId: f.organizationId, teamId: f.teamId });
    const candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope, documentId: doc.id, chunkId: doc.chunkId, model: "test", graph: { entities: [{ key: "a", kind: "person", canonicalName: "Liu Bei" }], relationships: [] }, now: f.now }));
    await f.change(doc);
    expect(await candidates.accept({ candidateId: candidate.id, organizationId: f.organizationId, entityPromotions: [{ key: "a", id: randomUUID() }], relationshipIds: [], reviewedBy: f.otherUserId, reviewedAt: f.now })).toEqual({ status: "access_denied" });
    expect(await f.db.select().from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, f.organizationId))).toEqual([]);
  });

  it("does not expose skipped private knowledge through an accepted candidate replay", async () => {
    const f = await fixture();
    const privateDoc = await f.document();
    await f.node("Liu Bei", privateDoc.chunkId);
    const candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope, documentId: f.doc.id, chunkId: f.doc.chunkId, model: "test", graph: { entities: [{ key: "a", kind: "person", canonicalName: "Liu Bei" }], relationships: [] }, now: f.now }));
    expect(await candidates.accept({ candidateId: candidate.id, organizationId: f.organizationId, entityPromotions: [{ key: "a", id: randomUUID() }], relationshipIds: [], reviewedBy: f.userId, reviewedAt: f.now })).toMatchObject({ status: "promoted", nodes: [{ canonicalName: "Liu Bei" }] });
    await f.change();
    await f.db.update(organizationMembers).set({ role: "admin" }).where(and(eq(organizationMembers.organizationId, f.organizationId), eq(organizationMembers.userId, f.otherUserId)));
    expect(await candidates.accept({ candidateId: candidate.id, organizationId: f.organizationId, entityPromotions: [], relationshipIds: [], reviewedBy: f.otherUserId, reviewedAt: f.now })).toMatchObject({ status: "promoted", candidate: { status: "accepted", scope: f.target }, nodes: [], edges: [] });
  });

  it("narrows verified graph and rejects stale graph writes and deletes", async () => {
    const f = await fixture();
    const doc = await f.document(f.target);
    const a = await f.node("Liu Bei", doc.chunkId, f.target), b = await f.node("Guan Yu", doc.chunkId, f.target);
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.target, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: doc.chunkId }, now: f.now }));
    expect(await f.change(doc, f.scope)).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 2 }, edges: { updated: 1 } } });
    await expect(f.graph.saveNode(a)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    await expect(f.graph.deleteNode(f.organizationId, a.id, f.target)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    await expect(f.graph.deleteEdge(f.organizationId, edge.id, f.target)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    expect(await f.db.select().from(knowledgeEdges).where(eq(knowledgeEdges.id, edge.id))).toHaveLength(1);
  });
});
