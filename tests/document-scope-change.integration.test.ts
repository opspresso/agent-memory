import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createDocumentScopeChangeRepository } from "@/infrastructure/database/repositories/document-scope-change-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createKnowledgeTermUsageRepository } from "@/infrastructure/database/repositories/knowledge-term-usage-repository";
import { documents, documentChunks, documentScopeChanges, organizations, organizationMembers, users, teams, teamMembers, knowledgeNodes, knowledgeEdges, knowledgeNodeSources, knowledgeEdgeSources, memories, knowledgeCandidates, knowledgeGraphVersions } from "@/infrastructure/database/schema";
import { createKnowledgeNode, createKnowledgeEdge } from "@/domain/knowledge/knowledge-graph";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { ScopedResource, OrganizationAccess } from "@/domain/identity/organization-access";
import { KnowledgeScopeChangedError } from "@/domain/knowledge/knowledge-scope-change";
import { createMemory } from "@/domain/memory/memory";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { buildArchiveDocument } from "@/application/document/archive-document";
import { DocumentNotFoundError } from "@/application/document/get-document";
import { buildSuggestKnowledgeOntology } from "@/application/knowledge/recommend-ontology";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import type { KnowledgeVerificationService } from "@/domain/knowledge/knowledge-verification-service";
import { assessKnowledgeCandidate } from "@/domain/knowledge/knowledge-curation-policy";
import type { KnowledgeSource } from "@/domain/knowledge/knowledge-source";
import { KnowledgeAssessmentUnavailableError } from "@/domain/knowledge/knowledge-assessment";
import { buildAcceptKnowledgeCandidate } from "@/application/knowledge/review-knowledge-candidate";
import { scopeCoveragePredicate } from "@/infrastructure/database/repositories/scope-predicates";
import { scopeCovers } from "@/domain/identity/scope-coverage";

describe("document scope transactions", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
  });
  afterAll(async () => { await database?.close(); await container?.stop(); });

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
      const actor = nodeScope.kind === "user" && nodeScope.userId !== userId
        ? { ...access, userId: nodeScope.userId, role: "member" as const } : access;
      return graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: nodeScope, kind: "person", canonicalName: name, source: { chunkId }, now }), actor);
    }
    const change = (record = doc, nextScope: ScopedResource = target, actor = access) => scopeRepository.changeScope({ access: actor, documentId: record.id, scope: nextScope, expectedUpdatedAt: record.updatedAt.toISOString(), now });
    return { ...database, organizationId, userId, otherUserId, teamId, now, access, scope, target, doc, document, node, graph, change };
  }

  async function assessedCandidate(f: Awaited<ReturnType<typeof fixture>>, context: KnowledgeSource, verdict: "accept" | "ignore" | "review" = "review") {
    const doc = await f.document(f.target), candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.target,
      documentId: doc.id, chunkId: doc.chunkId, model: "extractor", now: f.now,
      graph: { entities: [{ key: "liu", kind: "person", canonicalName: "Liu Bei" }], relationships: [] } }));
    const scope = context.chunkId
      ? (await createDocumentRepository(f.db).findChunkById(f.organizationId, context.chunkId))!.document.scope
      : (await createMemoryRepository(f.db).findById(f.organizationId, context.memoryId!))!.scope;
    const contextNode = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope, kind: "person", canonicalName: "Liu Bei",
      summary: "Context.", source: context, now: f.now }), f.access);
    const assessment = assessKnowledgeCandidate({ candidate, model: "verifier", content: "Liu Bei meets Guan Yu.",
      contextNodes: [contextNode], now: f.now, ontology: null, items: [{ item: "entity:liu", entityKind: "person",
        representation: "entity", support: verdict === "accept" ? "explicit" : verdict === "ignore" ? "unsupported" : "uncertain",
        usefulness: "useful", conflict: false, evidence: "Liu Bei meets Guan Yu.", reason: "context-assessment-sentinel" }] });
    await candidates.saveAssessment(f.organizationId, candidate.id, assessment);
    return { doc, candidate, assessment, candidates, contextNode };
  }

  it("returns a newly verified older extraction in the latest fifty history records", async () => {
    const f = await fixture(), repository = createKnowledgeCandidateRepository(f.db);
    const candidates = Array.from({ length: 51 }, (_, index) => createKnowledgeCandidate({
      id: randomUUID(), scope: f.scope, documentId: f.doc.id, chunkId: randomUUID(), model: "extractor",
      now: new Date(f.now.getTime() - 60_000 + index * 1_000),
      graph: { entities: [{ key: "liu", kind: "person", canonicalName: "Liu Bei" }], relationships: [] }
    }));
    await f.db.insert(documentChunks).values(candidates.map((candidate, index) => ({
      id: candidate.chunkId, organizationId: f.organizationId, documentId: f.doc.id,
      ordinal: index + 1, content: "Liu Bei meets Guan Yu."
    })));
    const assessmentFor = (candidate: typeof candidates[number], now: Date) => assessKnowledgeCandidate({
      candidate, content: "Liu Bei meets Guan Yu.", model: "verifier", now, ontology: null,
      items: [{ item: "entity:liu", entityKind: "person", representation: "entity", support: "uncertain",
        usefulness: "useful", conflict: false, evidence: "Liu Bei meets Guan Yu.", reason: "Needs review." }]
    });
    for (const candidate of candidates) {
      await repository.save(candidate);
      await repository.saveAssessment(f.organizationId, candidate.id, {
        ...assessmentFor(candidate, candidate.createdAt), policyVersion: "previous-policy"
      });
    }
    const oldest = candidates[0]!;
    expect((await repository.listReviewSources(f.access, true)).map((row) => row.candidate.id)).not.toContain(oldest.id);

    await repository.saveAssessment(f.organizationId, oldest.id, assessmentFor(oldest, f.now));

    const history = await repository.listReviewSources(f.access, true);
    expect(history).toHaveLength(50);
    expect(history[0]?.candidate.id).toBe(oldest.id);
    expect(history[0]?.candidate.updatedAt).toEqual(f.now);
    expect(history[0]?.candidate.assessmentHistory).toHaveLength(1);
    await repository.saveAssessment(f.organizationId, oldest.id, assessmentFor(oldest, new Date(f.now.getTime() + 60_000)));
    expect((await repository.findById(f.organizationId, oldest.id))?.updatedAt).toEqual(f.now);
  });

  it("keeps SQL provenance audience coverage equal to the domain policy across organizations and owners", async () => {
    const f = await fixture(), other = await fixture(), secondTeam = randomUUID();
    await f.db.insert(teams).values({ id: secondTeam, organizationId: f.organizationId, slug: secondTeam, name: "Second team" });
    const scopes: ScopedResource[] = [f.target, f.scope, { kind: "user", organizationId: f.organizationId, userId: f.otherUserId },
      { kind: "team", organizationId: f.organizationId, teamId: f.teamId },
      { kind: "team", organizationId: f.organizationId, teamId: secondTeam }, other.target];
    const records = await Promise.all(scopes.map(async (scope) => ({ scope,
      document: await (scope.organizationId === f.organizationId ? f : other).document(scope) })));
    const source = alias(documents, "coverage_source"), target = alias(documents, "coverage_target");
    const rows = await f.db.select({ source: source.id, target: target.id, covered: scopeCoveragePredicate(source, target) })
      .from(source).innerJoin(target, sql`true`).where(and(
        inArray(source.id, records.map((record) => record.document.id)), inArray(target.id, records.map((record) => record.document.id))
      ));
    const byId = new Map<string, ScopedResource>(records.map((record) => [record.document.id, record.scope]));
    const selected = rows.filter((row) => byId.has(row.source) && byId.has(row.target));
    expect(selected).toHaveLength(scopes.length ** 2);
    for (const row of selected) expect(row.covered).toBe(scopeCovers(byId.get(row.source)!, byId.get(row.target)!));
  });

  it.each(["archived", "processing"] as const)("rejects a %s source even when existing knowledge has another readable source", async (status) => {
    const f = await fixture();
    const first = await f.node("Alice"), second = await f.node("Bob");
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId,
      scope: f.scope, sourceNodeId: first.id, targetNodeId: second.id, predicate: "knows", source: { chunkId: f.doc.chunkId }, now: f.now }), f.access);
    const stale = await f.document(f.scope, status);
    await expect(f.node("Alice", stale.chunkId)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    await expect(f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId,
      scope: f.scope, sourceNodeId: first.id, targetNodeId: second.id, predicate: "knows", source: { chunkId: stale.chunkId }, now: f.now }), f.access))
      .rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    expect(await f.db.select().from(knowledgeNodeSources).where(eq(knowledgeNodeSources.chunkId, stale.chunkId))).toEqual([]);
    expect(await f.db.select().from(knowledgeEdgeSources).where(eq(knowledgeEdgeSources.chunkId, stale.chunkId))).toEqual([]);
    expect((await f.graph.findEdgeById(f.organizationId, edge.id))?.sources).toEqual([{ chunkId: f.doc.chunkId }]);
  });

  it("collects ontology terms only from readable ready sources, including a reader's own private terms", async () => {
    const f = await fixture();
    for (const label of ["public", "own", "foreign", "archived", "processing"] as const) {
      const scope = label === "own" ? f.scope : label === "foreign"
        ? { ...f.scope, kind: "user" as const, userId: f.otherUserId } : f.target;
      const doc = await f.document(scope);
      const actor = label === "foreign" ? { ...f.access, userId: f.otherUserId, role: "member" as const } : f.access;
      const nodes = [];
      for (const name of ["Alpha", "Beta"]) nodes.push(await f.graph.saveNode(createKnowledgeNode({
        id: randomUUID(), scope, kind: `${label}_kind`, canonicalName: name,
        source: { chunkId: doc.chunkId }, now: f.now
      }), actor));
      await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId,
        scope, sourceNodeId: nodes[0]!.id, targetNodeId: nodes[1]!.id, predicate: `${label}_predicate`,
        source: { chunkId: doc.chunkId }, now: f.now }), actor);
      await createKnowledgeCandidateRepository(f.db).save(createKnowledgeCandidate({
        id: randomUUID(), scope, documentId: doc.id, chunkId: doc.chunkId, model: "test", now: f.now,
        graph: { entities: [{ key: "a", kind: `${label}_candidate`, canonicalName: "Alpha" },
          { key: "b", kind: `${label}_candidate`, canonicalName: "Beta" }],
        relationships: [{ sourceKey: "a", targetKey: "b", predicate: `${label}_proposed` }] }
      }));
      if (label === "archived" || label === "processing") {
        await f.db.update(documents).set({ status: label }).where(eq(documents.id, doc.id));
      }
    }
    const usageRepository = createKnowledgeTermUsageRepository(f.db);
    const usage = await usageRepository.collect(f.access);
    expect(Object.fromEntries(usage.nodeKinds.map(({ term, count }) => [term, count]))).toEqual({
      public_kind: 2, own_kind: 2, public_candidate: 2, own_candidate: 2
    });
    expect(Object.fromEntries(usage.edgePredicates.map(({ term, count }) => [term, count]))).toEqual({
      public_predicate: 1, own_predicate: 1, public_proposed: 1, own_proposed: 1
    });
    expect(usage.nodeKinds.map(({ term }) => term)).toEqual(["own_candidate", "own_kind", "public_candidate", "public_kind"]);
    const suggest = vi.fn().mockResolvedValue({ nodeKinds: [], edgePredicates: [] });
    await buildSuggestKnowledgeOntology({ ontologyReader: createKnowledgeOntologyReader(f.db), usageRepository,
      suggestionService: { suggest } })(f.access);
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ usage }));
    const serviceUsage = await usageRepository.collect({ ...f.access, principalKind: "organization-agent" });
    expect(serviceUsage.nodeKinds.map(({ term }) => term)).toEqual(["public_candidate", "public_kind"]);
    expect(serviceUsage.edgePredicates.map(({ term }) => term)).toEqual(["public_predicate", "public_proposed"]);
  });

  it("excludes rejected terms and does not count an approved item twice in a partially reviewed candidate", async () => {
    const f = await fixture();
    const candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({
      id: randomUUID(), scope: f.scope, documentId: f.doc.id, chunkId: f.doc.chunkId, model: "test", now: f.now,
      graph: { entities: [
        { key: "a", kind: "approved_kind", canonicalName: "Alpha" },
        { key: "b", kind: "rejected_kind", canonicalName: "Beta" },
        { key: "c", kind: "pending_kind", canonicalName: "Gamma" }
      ], relationships: [
        { sourceKey: "a", targetKey: "c", predicate: "pending_predicate" },
        { sourceKey: "b", targetKey: "c", predicate: "rejected_predicate" }
      ] }
    }));
    await candidates.accept({ organizationId: f.organizationId, candidateId: candidate.id,
      reviewedBy: f.userId, reviewedAt: f.now, entityPromotions: [{ key: "a", id: randomUUID() }],
      relationshipIds: [randomUUID(), randomUUID()], selection: { entityKeys: ["a"], relationshipIndexes: [] } });
    await candidates.reject({ organizationId: f.organizationId, candidateId: candidate.id,
      reviewedBy: f.userId, reviewedAt: f.now, selection: { entityKeys: ["b"], relationshipIndexes: [1] } });
    expect((await candidates.findById(f.organizationId, candidate.id))?.status).toBe("pending");
    const usage = await createKnowledgeTermUsageRepository(f.db).collect(f.access);
    expect(usage.nodeKinds).toEqual([{ term: "approved_kind", count: 1 }, { term: "pending_kind", count: 1 }]);
    expect(usage.edgePredicates).toEqual([{ term: "pending_predicate", count: 1 }]);
  });

  it.each(["expired", "future"] as const)("rejects a %s Memory contribution to existing knowledge", async (state) => {
    const f = await fixture();
    await f.node("Alice");
    const memory = createMemory({ id: randomUUID(), scope: f.scope, kind: "fact", title: "Source",
      content: "Alice is a named person.", source: { type: "user" }, createdBy: f.userId, now: f.now,
      validFrom: new Date(f.now.getTime() + (state === "future" ? 60_000 : -60_000)),
      ...(state === "expired" ? { expiresAt: new Date(f.now.getTime() - 1) } : {}) });
    await createMemoryRepository(f.db).save(memory);
    await expect(f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person",
      canonicalName: "Alice", source: { memoryId: memory.id }, now: f.now }), f.access)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    expect(await f.db.select().from(knowledgeNodeSources).where(eq(knowledgeNodeSources.memoryId, memory.id))).toEqual([]);
  });

  it("changes the document, verified graph and candidate scope, preserving chunks and provenance", async () => {
    const f = await fixture();
    const a = await f.node("Liu Bei"), b = await f.node("Guan Yu");
    await f.graph.saveNode(createKnowledgeNode({ ...a, source: { chunkId: f.doc.chunkId }, now: f.now,
      embedding: { model: "scope-vector", values: [1, 0] } }), f.access);
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: f.doc.chunkId }, now: f.now }), f.access);
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
    const semantic = await f.graph.searchNodes({ access: reader, query: "unrelated", limit: 10,
      queryEmbedding: { model: "scope-vector", values: [1, 0] } });
    expect(semantic).toMatchObject([{ node: { id: a.id }, vectorScore: 1 }]);
    expect(semantic[0]?.node).not.toHaveProperty("embedding");
    expect((await f.graph.findNodeById(f.organizationId, a.id))?.sources).toEqual([{ chunkId: f.doc.chunkId }]);
  });

  it.each(["private", "public"] as const)("does not publish private verification context after sharing, even with a %s source document", async (sourceScope) => {
    const f = await fixture(), context = await f.document(sourceScope === "public" ? f.target : f.scope);
    const sentinel = "private-assessment-context-sentinel";
    await f.db.update(documentChunks).set({ content: sourceScope === "public"
      ? "Liu Bei is described in this public source." : `Liu Bei leads ${sentinel}.` }).where(eq(documentChunks.id, context.chunkId));
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person", canonicalName: "Liu Bei",
      summary: sentinel, source: { chunkId: context.chunkId }, now: f.now }), f.access);
    const candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.scope,
      documentId: f.doc.id, chunkId: f.doc.chunkId, model: "extractor", now: f.now,
      graph: { entities: [{ key: "liu", kind: "person", canonicalName: "Liu Bei" }], relationships: [] } }));
    const verify = vi.fn<KnowledgeVerificationService["verify"]>().mockImplementation(async (input) => ({ model: "verifier",
      items: [{ item: "entity:liu", entityKind: "person", representation: "entity", support: "uncertain", usefulness: "useful",
        conflict: true, evidence: input.content, reason: `Compare against ${input.existingKnowledge[0]?.summary}` }] }));
    const curate = buildCurateKnowledgeCandidate({ candidates, documents: createDocumentRepository(f.db),
      access: createOrganizationAccessRepository(f.db), graph: f.graph, ontology: createKnowledgeOntologyReader(f.db),
      verification: { verify }, accept: vi.fn(), reject: vi.fn(), clock: () => f.now });
    const revision = await f.db.select().from(knowledgeGraphVersions).where(eq(knowledgeGraphVersions.organizationId, f.organizationId));
    await curate(f.organizationId, f.doc.chunkId, f.userId);
    expect(await f.db.select().from(knowledgeGraphVersions).where(eq(knowledgeGraphVersions.organizationId, f.organizationId))).toEqual(revision);
    const assessed = (await candidates.findById(f.organizationId, candidate.id))!.assessment!;
    expect(assessed.items[0]?.reason).toContain(sentinel);
    await candidates.saveAssessment(f.organizationId, candidate.id, { ...assessed, policyVersion: "previous-fixture-policy" });
    await curate(f.organizationId, f.doc.chunkId, f.userId);
    expect((await candidates.findById(f.organizationId, candidate.id))?.assessmentHistory?.length).toBeGreaterThan(0);
    expect(await f.change()).toMatchObject({ status: "changed" });
    await f.db.update(organizationMembers).set({ role: "admin" }).where(and(
      eq(organizationMembers.organizationId, f.organizationId), eq(organizationMembers.userId, f.otherUserId)));
    const reader: OrganizationAccess = { ...f.access, userId: f.otherUserId, role: "admin" };
    const visible = await candidates.listPending(reader, 50);
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain(sentinel);
    expect(visible[0]?.assessment).toBeUndefined();
    expect(visible[0]?.assessmentHistory ?? []).toEqual([]);
    expect(await candidates.listReviewSources(reader, true)).toEqual([]);
  });

  it("keeps private aliases out of shared verification and identity matching", async () => {
    const f = await fixture(), shared = await f.document(f.target), restricted = await f.document(f.target);
    const node = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.target, kind: "person", canonicalName: "Liu Bei",
      summary: "Public context.", source: { chunkId: shared.chunkId }, now: f.now }), f.access);
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.target, kind: "person", canonicalName: "Liu Bei",
      aliases: ["private-alias-sentinel"], summary: "private-summary-sentinel", source: { chunkId: restricted.chunkId }, now: f.now }), f.access);
    const peer = await f.node("Guan Yu", shared.chunkId, f.target);
    await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.target,
      sourceNodeId: node.id, targetNodeId: peer.id, predicate: "knows", source: { chunkId: shared.chunkId }, now: f.now }), f.access);
    expect(await f.change(restricted, f.scope)).toMatchObject({ status: "changed", knowledge: { nodes: { skipped: 1 } } });
    expect(JSON.stringify(await f.graph.findNodesByNames(f.access, f.target, ["Liu Bei"]))).toContain("private-summary-sentinel");
    const context = await f.graph.findNodesForScope(f.access, f.target, ["Liu Bei"]);
    expect(context).toMatchObject([{ canonicalName: "Liu Bei", summary: "Public context.", aliases: [], sources: [{ chunkId: shared.chunkId }] }]);
    expect(JSON.stringify(context)).not.toContain("private-");
    expect(await f.graph.findNodesForScope(f.access, f.target, ["private-alias-sentinel"])).toEqual([]);
    const privateNamedSource = await f.document();
    await f.db.update(documentChunks).set({ content: "private-alias-sentinel is a named person." }).where(eq(documentChunks.id, privateNamedSource.chunkId));
    const privateNamedNode = await f.node("private-alias-sentinel", privateNamedSource.chunkId);
    expect(await f.change(privateNamedSource)).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1, skipped: 0 } } });
    const newSource = await f.document(f.target);
    await f.db.update(documentChunks).set({ content: "private-alias-sentinel is a named person." }).where(eq(documentChunks.id, newSource.chunkId));
    const independentlyNamed = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.target,
      kind: "person", canonicalName: "private-alias-sentinel", source: { chunkId: newSource.chunkId }, now: f.now }), f.access);
    expect(independentlyNamed.id).not.toBe(node.id);
    expect(independentlyNamed.id).toBe(privateNamedNode.id);
    const candidates = createKnowledgeCandidateRepository(f.db);
    const candidate = await candidates.save(createKnowledgeCandidate({ id: randomUUID(), scope: f.target, documentId: newSource.id,
      chunkId: newSource.chunkId, model: "test", now: f.now,
      graph: { entities: [{ key: "alias", kind: "person", canonicalName: "private-alias-sentinel" }], relationships: [] } }));
    await candidates.saveAssessment(f.organizationId, candidate.id, assessKnowledgeCandidate({ candidate, model: "verifier",
      content: "private-alias-sentinel is a named person.", now: f.now, ontology: null, items: [{ item: "entity:alias", representation: "entity",
        entityKind: "person", support: "explicit", usefulness: "useful", conflict: false,
        evidence: "private-alias-sentinel is a named person.", reason: "Explicit independent name." }] }));
    expect(await candidates.accept({ organizationId: f.organizationId, candidateId: candidate.id, method: "automatic",
      entityPromotions: [{ key: "alias", id: randomUUID() }], relationshipIds: [], reviewedBy: f.userId, reviewedAt: f.now }))
      .toMatchObject({ status: "promoted", nodes: [{ id: independentlyNamed.id }] });
  });

  it.each(["archive", "private"])("invalidates a pending assessment and progress when a context document becomes %s", async (change) => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId });
    expect((await test.candidates.processingProgress(f.access)).curatedChunks).toBe(1);
    if (change === "private") await f.change(context, f.scope);
    else await createDocumentRepository(f.db).archive(f.organizationId, context.id, f.now, f.target);
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
    expect((await test.candidates.findByChunkId(f.organizationId, test.doc.chunkId))?.assessment).toBeUndefined();
    expect((await test.candidates.processingProgress(f.access)).curatedChunks).toBe(0);
    expect(await test.candidates.listReviewSources(f.access, true)).toEqual([]);
    expect(JSON.stringify(await test.candidates.listPending(f.access, 50))).not.toContain("context-assessment-sentinel");
    const replacement = { ...test.assessment, sources: [{ chunkId: test.doc.chunkId }], contextNodeIds: [],
      items: test.assessment.items.map((item) => ({ ...item, reason: "Source-only verification." })) };
    const saved = await test.candidates.saveAssessment(f.organizationId, test.candidate.id, replacement);
    expect(saved?.assessment).toEqual(replacement);
    expect(saved?.assessmentHistory ?? []).toEqual([]);
    const [stored] = await f.db.select().from(knowledgeCandidates).where(eq(knowledgeCandidates.id, test.candidate.id));
    expect(stored?.assessmentHistory).toEqual([test.assessment]);
  });

  it.each(["archived", "expired", "future"])("hides assessment provenance from a %s context Memory", async (state) => {
    const f = await fixture();
    const memory = createMemory({ id: randomUUID(), scope: f.target, title: "Context", content: "Liu Bei context.",
      kind: "fact", source: { type: "user" }, createdBy: f.userId, validFrom: new Date(f.now.getTime() - 60_000), now: f.now });
    await createMemoryRepository(f.db).save(memory);
    const test = await assessedCandidate(f, { memoryId: memory.id });
    await f.db.update(memories).set(state === "archived" ? { status: "archived" } : state === "expired"
      ? { expiresAt: new Date(f.now.getTime() - 1) } : { validFrom: new Date(f.now.getTime() + 60_000) }).where(eq(memories.id, memory.id));
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
    expect((await test.candidates.processingProgress(f.access)).curatedChunks).toBe(0);
  });

  it("retains independently readable history when the current assessment's context becomes private", async () => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId });
    const prior = { ...test.assessment, policyVersion: "previous-public-policy", sources: [{ chunkId: test.doc.chunkId }], contextNodeIds: [],
      items: test.assessment.items.map((item) => ({ ...item, reason: "Public source-only history." })) };
    await test.candidates.saveAssessment(f.organizationId, test.candidate.id, prior);
    await test.candidates.saveAssessment(f.organizationId, test.candidate.id, test.assessment);
    await f.change(context, f.scope);
    const history = await test.candidates.listReviewSources(f.access, true);
    expect(history).toHaveLength(1);
    expect(history[0]?.candidate.assessment).toBeUndefined();
    expect(history[0]?.candidate.assessmentHistory).toEqual([prior]);
    expect(JSON.stringify(history)).not.toContain("context-assessment-sentinel");
  });

  it.each(["missing", "empty", "invalid-id", "ambiguous"])("hides %s provenance without aborting candidate reads", async (shape) => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId });
    const sources = shape === "missing" ? undefined : shape === "empty" ? [] : [{ chunkId: test.doc.chunkId },
      shape === "invalid-id" ? { chunkId: "not-a-uuid" } : { chunkId: context.chunkId, memoryId: randomUUID() }];
    await f.pool.query("UPDATE knowledge_candidates SET assessment=$2 WHERE id=$1", [test.candidate.id,
      JSON.stringify({ ...test.assessment, sources })]);
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
    expect(await test.candidates.listReviewSources(f.access, true)).toEqual([]);
    expect((await test.candidates.processingProgress(f.access)).curatedChunks).toBe(0);
  });

  it.each(["accept", "reject"] as const)("refuses stale automatic %s and filters the subsequent human review response", async (decision) => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId }, decision === "accept" ? "accept" : "ignore");
    await f.change(context, f.scope);
    const input = { organizationId: f.organizationId, candidateId: test.candidate.id,
      reviewedBy: f.userId, reviewedAt: f.now, selection: { entityKeys: ["liu"], relationshipIndexes: [] },
      entityPromotions: [{ key: "liu", id: randomUUID() }], relationshipIds: [] };
    await expect(test.candidates[decision]({ ...input, method: "automatic" })).rejects.toBeInstanceOf(KnowledgeAssessmentUnavailableError);
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.itemReviews).toEqual([]);
    const reviewed = await test.candidates[decision](input);
    expect(JSON.stringify(reviewed)).not.toContain("context-assessment-sentinel");
  });

  it("rechecks assessment sources after embedding and refuses to promote stale automatic decisions", async () => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId }, "accept");
    const embedMany = vi.fn(async (texts: readonly string[]) => {
      await f.change(context, f.scope);
      return texts.map(() => ({ model: "test", values: [1, 0] }));
    });
    const accept = buildAcceptKnowledgeCandidate({ repository: test.candidates, documentRepository: createDocumentRepository(f.db),
      ontologyReader: createKnowledgeOntologyReader(f.db), clock: () => f.now, generateId: randomUUID, method: "automatic",
      embeddingService: { embed: vi.fn(), embedMany } });
    await expect(accept(f.access, test.candidate.id)).rejects.toBeInstanceOf(KnowledgeAssessmentUnavailableError);
    expect(embedMany).toHaveBeenCalledOnce();
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.status).toBe("pending");
    expect((await f.db.select().from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, f.organizationId))).map((node) => node.id)).toEqual([test.contextNode.id]);
  });

  it("does not give an organization-agent reviewer its issuer's private rights after embedding", async () => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId }, "accept");
    const embedMany = vi.fn(async (texts: readonly string[]) => {
      await f.change(test.doc, f.scope);
      return texts.map(() => ({ model: "test", values: [1, 0] }));
    });
    const accept = buildAcceptKnowledgeCandidate({ repository: test.candidates, documentRepository: createDocumentRepository(f.db),
      ontologyReader: createKnowledgeOntologyReader(f.db), clock: () => f.now, generateId: randomUUID,
      embeddingService: { embed: vi.fn(), embedMany } });
    await expect(accept({ ...f.access, principalKind: "organization-agent" }, test.candidate.id)).rejects.toThrow("knowledge candidate review access denied");
    expect(embedMany).toHaveBeenCalledOnce();
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.status).toBe("pending");
    const input = { organizationId: f.organizationId, candidateId: test.candidate.id, reviewedBy: f.userId,
      reviewedAt: f.now, principalKind: "organization-agent" as const };
    expect(await test.candidates.reject(input)).toBeNull();
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.status).toBe("pending");
  });

  it.each(["deleted", "private"])("invalidates comparison with a %s context node while its source document remains public", async (change) => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId });
    if (change === "deleted") await f.graph.deleteNode(f.organizationId, test.contextNode.id, f.target);
    else await f.db.update(knowledgeNodes).set({ scopeKind: "user", userId: f.userId, teamId: null }).where(eq(knowledgeNodes.id, test.contextNode.id));
    expect((await createDocumentRepository(f.db).findById(f.organizationId, context.id))?.scope).toEqual(f.target);
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
    expect((await test.candidates.processingProgress(f.access)).curatedChunks).toBe(0);
  });

  it("preserves assessment provenance through explicit node merges and checks the surviving node's scope", async () => {
    const f = await fixture(), context = await f.document(f.target);
    const test = await assessedCandidate(f, { chunkId: context.chunkId });
    await f.db.update(documentChunks).set({ content: "Liu Bei is also called Xuande (玄德)." }).where(eq(documentChunks.id, context.chunkId));
    const target = await f.node("Xuande", context.chunkId, f.target);
    await f.graph.mergeNodes({ organizationId: f.organizationId, sourceNodeId: test.contextNode.id, targetNodeId: target.id,
      mergedBy: f.userId, reason: "Verified courtesy name", now: f.now });
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toEqual(test.assessment);
    await f.db.update(knowledgeNodes).set({ scopeKind: "user", userId: f.userId }).where(eq(knowledgeNodes.id, target.id));
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
    const next = await f.node("玄德", context.chunkId, f.scope);
    await f.graph.mergeNodes({ organizationId: f.organizationId, sourceNodeId: target.id, targetNodeId: next.id,
      mergedBy: f.userId, reason: "Verified original name", now: f.now });
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
    await f.db.update(knowledgeNodes).set({ scopeKind: "organization", userId: null }).where(eq(knowledgeNodes.id, next.id));
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toEqual(test.assessment);
    await f.graph.deleteNode(f.organizationId, next.id, f.target);
    expect((await test.candidates.findById(f.organizationId, test.candidate.id))?.assessment).toBeUndefined();
  });

  it("rejects unknown or cross-tenant assessment provenance without changing the stored decision", async () => {
    const f = await fixture(), other = await fixture();
    await expect(assessedCandidate(f, { chunkId: f.doc.chunkId })).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    const publicContext = await f.document(f.target);
    const valid = await assessedCandidate(f, { chunkId: publicContext.chunkId });
    await expect(valid.candidates.saveAssessment(f.organizationId, valid.candidate.id, { ...valid.assessment, policyVersion: "different-policy",
      sources: [{ chunkId: valid.doc.chunkId }, { chunkId: other.doc.chunkId }] })).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    expect((await valid.candidates.findById(f.organizationId, valid.candidate.id))?.assessment).toEqual(valid.assessment);
  });

  it("keeps mixed private provenance and dependent relations private", async () => {
    const f = await fixture();
    const privateDoc = await f.document();
    const a = await f.node("Liu Bei"), b = await f.node("Guan Yu");
    await f.node("Liu Bei", privateDoc.chunkId);
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: f.doc.chunkId }, now: f.now }), f.access);
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
      await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId }, now: f.now }), f.access);
    }
    expect(await f.change()).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 0 }, edges: { updated: 0, skipped: 1 }, skipped: [{ resource: "edge", reason: "identity_conflict", count: 1 }] } });
  });

  it.each(["private", "expired", "future"] as const)("does not widen knowledge backed by a %s Memory", async (kind) => {
    const f = await fixture();
    const memoryId = randomUUID();
    const source = createMemory({ id: memoryId, scope: kind === "private" ? f.scope : f.target, kind: "fact", title: "Memory evidence", content: "Liu Bei", source: { type: "user" }, createdBy: f.userId,
      validFrom: new Date(f.now.getTime() - 10000), now: f.now });
    await createMemoryRepository(f.db).save(source);
    const node = await f.node("Liu Bei");
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person", canonicalName: "Liu Bei", source: { memoryId }, now: f.now }), f.access);
    const unrelated = await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person", canonicalName: "Unrelated Memory", source: { memoryId }, now: f.now }), f.access);
    if (kind !== "private") {
      await f.pool.query("UPDATE memories SET valid_from=$2, expires_at=$3 WHERE id=$1", [memoryId,
        new Date(f.now.getTime() + (kind === "future" ? 10000 : -10000)),
        kind === "expired" ? new Date(f.now.getTime() - 1) : null]);
    }
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
    const edge = await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.target, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: doc.chunkId }, now: f.now }), f.access);
    expect(await f.change(doc, f.scope)).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 2 }, edges: { updated: 1 } } });
    await expect(f.graph.saveNode(createKnowledgeNode({ ...a, source: { chunkId: doc.chunkId }, now: f.now }), f.access)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    await expect(f.graph.deleteNode(f.organizationId, a.id, f.target)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    await expect(f.graph.deleteEdge(f.organizationId, edge.id, f.target)).rejects.toBeInstanceOf(KnowledgeScopeChangedError);
    expect(await f.db.select().from(knowledgeEdges).where(eq(knowledgeEdges.id, edge.id))).toHaveLength(1);
  });

  it("rejects an archive authorized against the document's previous scope", async () => {
    const f = await fixture();
    const doc = await f.document({ kind: "team", organizationId: f.organizationId, teamId: f.teamId });
    const repository = createDocumentRepository(f.db);
    const archive = buildArchiveDocument({ clock: () => new Date(), repository: {
      ...repository,
      async findById(organizationId, documentId) {
        const snapshot = await repository.findById(organizationId, documentId);
        await f.change(doc);
        return snapshot;
      }
    } });
    const manager: OrganizationAccess = { ...f.access, userId: f.otherUserId, role: "member", teams: [{ teamId: f.teamId, role: "manager" }] };
    await expect(archive(manager, doc.id)).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(await repository.findById(f.organizationId, doc.id)).toMatchObject({ status: "ready", scope: f.target });
  });

  it("allows a private document transition while retained public nodes use only visible properties", async () => {
    const f = await fixture();
    const doc = await f.document(f.target), other = await f.document(f.target);
    const safeNode = await f.node("Zhang Fei", doc.chunkId, f.target);
    const a = await f.node("Liu Bei", doc.chunkId, f.target);
    await f.graph.saveNode(createKnowledgeNode({ ...a, source: { chunkId: doc.chunkId }, now: f.now,
      properties: { privateDetail: "Details from the document being restricted" } }), f.access);
    await f.node("Liu Bei", other.chunkId, f.target);
    const b = await f.node("Guan Yu", other.chunkId, f.target);
    await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope: f.target, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId: other.chunkId }, now: f.now }), f.access);
    expect(await f.change(doc, f.scope)).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1, skipped: 1 } } });
    expect(await createDocumentRepository(f.db).findById(f.organizationId, doc.id)).toMatchObject({ scope: f.scope });
    expect((await f.graph.findNodeById(f.organizationId, a.id))?.properties.privateDetail).toBe("Details from the document being restricted");
    expect((await f.graph.findNodeById(f.organizationId, a.id))?.scope).toEqual(f.target);
    expect((await f.graph.findNodeById(f.organizationId, safeNode.id))?.scope).toEqual(f.scope);
    const reader = { ...f.access, userId: f.otherUserId, role: "member" as const };
    const visible = await f.graph.searchNodes({ access: reader, query: "Liu Bei", limit: 10 });
    expect(visible[0]?.node.properties).toEqual({});
    expect(visible[0]?.node.sources).toEqual([{ chunkId: other.chunkId }]);
    expect((await f.graph.findNeighborhood(reader, a.id, 1, 10)).edges).toHaveLength(1);
    expect(await f.db.select().from(documentScopeChanges).where(eq(documentScopeChanges.documentId, doc.id))).toHaveLength(1);
  });

  it("does not count an ineligible node as an identity collision in the target scope", async () => {
    const f = await fixture();
    const doc = await f.document(f.target);
    const privateNode = await f.node("Liu Bei", doc.chunkId);
    await f.node("Liu Bei", f.doc.chunkId);
    const eligible = await f.node("Liu Bei", doc.chunkId, { kind: "team", organizationId: f.organizationId, teamId: f.teamId });
    expect(await f.change(doc)).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1, skipped: 1 } } });
    expect((await f.graph.findNodeById(f.organizationId, eligible.id))?.scope).toEqual(f.target);
    expect((await f.graph.findNodeById(f.organizationId, privateNode.id))?.scope).toEqual(f.scope);
  });

  it("filters properties from a restricted document when an identity conflict retains its public edge", async () => {
    const f = await fixture();
    const doc = await f.document(f.target), other = await f.document(f.target);
    const a = await f.node("Liu Bei", other.chunkId, f.target), b = await f.node("Guan Yu", other.chunkId, f.target);
    for (const [scope, chunkId] of [[f.target, doc.chunkId], [f.target, other.chunkId], [f.scope, other.chunkId]] as const) {
      await f.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: f.organizationId, scope, sourceNodeId: a.id, targetNodeId: b.id, predicate: "knows", source: { chunkId }, now: f.now,
        properties: chunkId === doc.chunkId ? { privateDetail: "Restricted evidence" } : { publicDetail: "Visible evidence" } }), f.access);
    }
    expect(await f.change(doc, f.scope)).toMatchObject({ status: "changed", knowledge: { edges: { updated: 0, skipped: 1 } } });
    expect(await createDocumentRepository(f.db).findById(f.organizationId, doc.id)).toMatchObject({ scope: f.scope });
    const reader = { ...f.access, userId: f.otherUserId, role: "member" as const };
    const visible = await f.graph.findNeighborhood(reader, a.id, 1, 10);
    expect(visible.edges).toHaveLength(1);
    expect(visible.edges[0]?.properties).toEqual({ publicDetail: "Visible evidence" });
    expect(visible.edges[0]?.sources).toEqual([{ chunkId: other.chunkId }]);
    expect(await f.db.select().from(documentScopeChanges).where(eq(documentScopeChanges.documentId, doc.id))).toHaveLength(1);
  });

  it("does not treat shared aliases as identity when distinct representative names remain", async () => {
    const f = await fixture();
    const publicDocument = await f.document(f.target);
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.scope, kind: "person",
      canonicalName: "Alice", aliases: ["Sam"], source: { chunkId: f.doc.chunkId }, now: f.now }), f.access);
    await f.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: f.target, kind: "person",
      canonicalName: "Bob", aliases: ["Sam"], source: { chunkId: publicDocument.chunkId }, now: f.now }), f.access);
    expect(await f.change()).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 1, skipped: 0 } } });
    expect((await f.graph.findNodesByNames(f.access, f.target, ["Sam"])).map((node) => node.canonicalName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("changes large document graphs without exceeding PostgreSQL's parameter limit", async () => {
    const f = await fixture();
    await f.pool.query(`INSERT INTO knowledge_nodes (organization_id, scope_kind, user_id, kind, canonical_name)
      SELECT $1, 'user', $2, 'person', 'Person ' || n FROM generate_series(1, 35000) n`, [f.organizationId, f.userId]);
    await f.pool.query("ANALYZE knowledge_nodes");
    await f.pool.query(`INSERT INTO knowledge_node_sources (organization_id, node_id, chunk_id, names, primary_name_keys)
      SELECT organization_id, id, $2, jsonb_build_object(lower(canonical_name), canonical_name), ARRAY[lower(canonical_name)] FROM knowledge_nodes WHERE organization_id=$1`, [f.organizationId, f.doc.chunkId]);
    await f.pool.query("ANALYZE knowledge_node_sources");
    const result = await f.change().catch((error: unknown) => {
      // Keep a driver failure readable without printing tens of thousands of binds.
      throw error instanceof Error && error.cause instanceof Error ? error.cause : error;
    });
    expect(result).toMatchObject({ status: "changed", knowledge: { nodes: { updated: 35000, skipped: 0 } } });
  });
});
