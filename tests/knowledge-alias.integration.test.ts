import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createDatabase, type AgentMemoryDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createMemory } from "@/domain/memory/memory";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import { buildGenerateKnowledgeCandidate } from "@/application/knowledge/generate-knowledge-candidate";
import { buildAcceptKnowledgeCandidate, buildRejectKnowledgeCandidate } from "@/application/knowledge/review-knowledge-candidate";
import { createKnowledgeNode, createKnowledgeEdge } from "@/domain/knowledge/knowledge-graph";
import type { ProposedKnowledgeGraph } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeVerificationService } from "@/domain/knowledge/knowledge-verification-service";
import type { OrganizationAccess, ScopedResource } from "@/domain/identity/organization-access";

describe("source-grounded knowledge aliases", () => {
  let container: StartedPostgreSqlContainer, db: AgentMemoryDatabase, pool: Pool;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie")
      .withDatabase("knowledge_alias_test").withUsername("agent_memory").withPassword("agent_memory").start();
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    await initializeSchema(pool);
  });
  afterAll(async () => { await pool?.end(); await container?.stop(); });

  async function fixture() {
    const organizationId = randomUUID(), userId = randomUUID();
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'Aliases')", [organizationId, organizationId]);
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Reviewer')", [userId, `${userId}@example.test`]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId, userId]);
    const scope: ScopedResource = { organizationId, kind: "organization" };
    const access: OrganizationAccess = { organizationId, userId, role: "owner", teams: [] };
    const graph = createKnowledgeGraphRepository(db);
    const candidates = createKnowledgeCandidateRepository(db);
    const documents = createDocumentRepository(db);
    const ontology = createKnowledgeOntologyReader(db);
    const clock = () => new Date();
    const accept = buildAcceptKnowledgeCandidate({ repository: candidates, ontologyReader: ontology, clock, generateId: randomUUID, method: "automatic" });
    const reject = buildRejectKnowledgeCandidate({ repository: candidates, clock, method: "automatic" });
    const verify = vi.fn<KnowledgeVerificationService["verify"]>().mockImplementation(async (input) => ({ model: "independent-verifier", items: [
      ...input.graph.entities.map((entity) => `entity:${entity.key}`), ...input.graph.relationships.map((_, index) => `relationship:${index}`)
    ].map((item) => ({ item, support: "explicit", usefulness: "useful", conflict: false, evidence: input.content, reason: "The supplied source establishes this identity." })),
    aliases: input.graph.entities.flatMap((entity) => (entity.aliases ?? []).map((alias) => ({ entityKey: entity.key, alias, identity: "same_entity", evidence: input.content, reason: "Explicit alternative proper name." }))) }));
    const curate = buildCurateKnowledgeCandidate({ candidates, documents, graph, ontology, clock, accept, reject, verification: { verify }, access: createOrganizationAccessRepository(db) });
    async function source(content: string, targetScope = scope) {
      const documentId = randomUUID(), chunkId = randomUUID();
      await pool.query("INSERT INTO documents(id,organization_id,scope_kind,team_id,user_id,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,$3,$4,$5,'Source','fixture','checksum','text/plain','ready',$6)",
        [documentId, organizationId, targetScope.kind, targetScope.kind === "team" ? targetScope.teamId : null, targetScope.kind === "user" ? targetScope.userId : null, userId]);
      await pool.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,$4)", [chunkId, organizationId, documentId, content]);
      return { documentId, chunkId };
    }
    async function extract(content: string, proposed: ProposedKnowledgeGraph) {
      const origin = await source(content);
      const generate = buildGenerateKnowledgeCandidate({ candidateRepository: candidates, documentRepository: documents, ontologyReader: ontology, clock, generateId: randomUUID,
        extractionService: { extract: async () => ({ model: "extractor", graph: proposed }) } });
      const candidate = await generate(organizationId, origin.chunkId);
      return { ...origin, candidate };
    }
    async function promote(content: string, canonicalName: string, aliases: readonly string[] = []) {
      const result = await extract(content, { entities: [{ key: "person", kind: "person", canonicalName, aliases, evidence: [content] }], relationships: [] });
      await curate(organizationId, result.chunkId);
      const [node] = await graph.findNodesByNames(access, scope, [canonicalName]);
      expect(node).toBeDefined();
      return { ...result, node: node! };
    }
    return { organizationId, userId, scope, access, graph, candidates, source, promote, extract, curate, verify };
  }

  it("preserves verified aliases and reuses the same ID in later extraction and search", async () => {
    const test = await fixture();
    const first = await test.promote("제갈량의 자는 공명이며 제갈공명이라고도 불린다.", "제갈량", ["공명", "제갈공명"]);
    expect(first.node.aliases).toEqual(["공명", "제갈공명"]);
    const second = await test.promote("공명이 군사를 지휘했다.", "공명");
    expect(second.node.id).toBe(first.node.id);
    expect(test.verify.mock.calls.at(-1)?.[0].existingKnowledge).toContainEqual(expect.objectContaining({ name: "제갈량", aliases: ["공명", "제갈공명"] }));
    expect(second.node.sources).toHaveLength(2);
    for (const name of ["제갈량", "공명", "제갈공명"]) {
      expect((await test.graph.findNodesByNames(test.access, test.scope, [name])).map((node) => node.id)).toEqual([first.node.id]);
      expect((await test.graph.searchNodes({ access: test.access, query: name, limit: 10 })).map((hit) => hit.node.id)).toEqual([first.node.id]);
    }
    await pool.query("UPDATE documents SET status='archived' WHERE id=$1", [first.documentId]);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["제갈공명"])).toEqual([]);
    expect(await test.graph.searchNodes({ access: test.access, query: "제갈공명", limit: 10 })).toEqual([]);
    const remaining = await test.graph.findNodesByNames(test.access, test.scope, ["공명"]);
    expect(remaining[0]?.aliases).toEqual(["공명"]);
    const saved = await test.graph.saveNode(createKnowledgeNode({ id: randomUUID(), canonicalName: "공명", kind: "person", scope: test.scope,
      source: { chunkId: second.chunkId }, now: new Date() }), test.access);
    expect(saved.id).toBe(first.node.id);
    expect(saved.aliases).toEqual(["공명"]);
  });

  it("merges fragmented identities while retaining edges, provenance and previous approval bindings", async () => {
    const test = await fixture();
    const first = await test.promote("제갈량이 전략을 세웠다.", "제갈량");
    const second = await test.promote("공명이 장수에게 병법을 가르쳤다.", "공명");
    const third = await test.promote("제갈공명이 군사를 지휘했다.", "제갈공명");
    const student = await test.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: test.scope, canonicalName: "장수", kind: "person", source: { chunkId: second.chunkId }, now: new Date() }));
    const edge = await test.graph.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId: test.organizationId, scope: test.scope, sourceNodeId: second.node.id, targetNodeId: student.id,
      predicate: "teaches", source: { chunkId: second.chunkId }, now: new Date() }));
    const linked = await test.promote("제갈량의 자는 공명이며 제갈공명이라고도 불린다.", "제갈량", ["공명", "제갈공명"]);
    expect(linked.node.id).toBe(first.node.id);
    expect(linked.node.sources).toHaveLength(4);
    expect(await test.graph.findNodeById(test.organizationId, second.node.id)).toBeNull();
    expect(await test.graph.findNodeById(test.organizationId, third.node.id)).toBeNull();
    expect(await test.graph.findEdgeById(test.organizationId, edge.id)).toMatchObject({ sourceNodeId: first.node.id, targetNodeId: student.id });
    const replay = await test.candidates.accept({ organizationId: test.organizationId, candidateId: second.candidate.id, reviewedBy: test.userId, reviewedAt: new Date(), entityPromotions: [], relationshipIds: [] });
    expect(replay.status).toBe("promoted");
    if (replay.status === "promoted") expect(replay.nodes.map((node) => node.id)).toEqual([first.node.id]);
    expect((await pool.query("SELECT count(*)::int AS count FROM knowledge_node_merges WHERE organization_id=$1", [test.organizationId])).rows[0].count).toBe(2);
  });

  it("serializes concurrent inverse alias proposals onto one entity", async () => {
    const test = await fixture();
    const content = "제갈량의 자는 공명이다.";
    const proposed = (name: string, alias: string): ProposedKnowledgeGraph => ({ entities: [{ key: "p", kind: "person", canonicalName: name, aliases: [alias], evidence: [content] }], relationships: [] });
    const inputs = await Promise.all([test.extract(content, proposed("제갈량", "공명")), test.extract(content, proposed("공명", "제갈량"))]);
    await Promise.all(inputs.map((input) => test.curate(test.organizationId, input.chunkId)));
    const nodes = await test.graph.findNodesByNames(test.access, test.scope, ["제갈량", "공명"]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.sources).toHaveLength(2);
  });

  it("remaps earlier items in the same candidate when a later alias merges their node", async () => {
    const test = await fixture();
    const original = await test.promote("제갈량은 군사다.", "제갈량");
    await test.promote("공명은 군사를 지휘한다.", "공명");
    const content = "공명은 제갈량의 자이며 장수에게 병법을 가르친 군사다.";
    const input = await test.extract(content, { entities: [
      { key: "courtesy", kind: "person", canonicalName: "공명", summary: "병법을 가르친다." },
      { key: "name", kind: "person", canonicalName: "제갈량", aliases: ["공명"], summary: "군사다." },
      { key: "student", kind: "person", canonicalName: "장수" }
    ], relationships: [{ sourceKey: "courtesy", targetKey: "student", predicate: "teaches" }] });
    await test.curate(test.organizationId, input.chunkId);
    const result = await test.graph.findNeighborhood(test.access, original.node.id, 1, 10);
    expect(result.edges).toEqual([expect.objectContaining({ sourceNodeId: original.node.id, predicate: "teaches" })]);
    const source = await pool.query("SELECT description FROM knowledge_node_sources WHERE node_id=$1 AND chunk_id=$2", [original.node.id, input.chunkId]);
    expect(source.rows[0].description).toContain("병법을 가르친다.");
    expect(source.rows[0].description).toContain("군사다.");
  });

  it("defers an ambiguous shared alias and still applies independent knowledge", async () => {
    const test = await fixture();
    for (const name of ["Alice", "Bob"]) {
      await test.promote(`${name} is also known as Sam.`, name, ["Sam"]);
    }
    test.verify.mockClear();
    const content = "Sam spoke with Carol.";
    const input = await test.extract(content, { entities: [{ key: "sam", kind: "person", canonicalName: "Sam" }, { key: "carol", kind: "person", canonicalName: "Carol" }],
      relationships: [{ sourceKey: "sam", targetKey: "carol", predicate: "spoke_with" }] });
    await test.curate(test.organizationId, input.chunkId);
    const candidate = await test.candidates.findByChunkId(test.organizationId, input.chunkId);
    expect(candidate?.status).toBe("pending");
    expect(candidate?.assessment?.items.filter((item) => item.verdict === "review").map((item) => item.item)).toEqual(["entity:sam", "relationship:0"]);
    expect(candidate?.itemReviews).toEqual([expect.objectContaining({ item: "entity:carol", decision: "accepted", method: "automatic" })]);
    expect((await test.graph.findNodesByNames(test.access, test.scope, ["Sam"])).map((node) => node.canonicalName).sort()).toEqual(["Alice", "Bob"]);
    await test.curate(test.organizationId, input.chunkId);
    expect(test.verify).toHaveBeenCalledOnce();
  });

  it("does not promote aliases that verification left uncertain", async () => {
    const test = await fixture();
    test.verify.mockImplementation(async (input) => ({ model: "verifier", items: input.graph.entities.map((entity) => ({
      item: `entity:${entity.key}`, support: "uncertain", usefulness: "useful", conflict: false, evidence: input.content, reason: "The title does not establish a unique identity."
    })) }));
    const input = await test.extract("제갈량과 승상이 각각 군사를 지휘했다.", { entities: [{ key: "p", kind: "person", canonicalName: "제갈량", aliases: ["승상"] }], relationships: [] });
    await test.curate(test.organizationId, input.chunkId);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["제갈량", "승상"])).toEqual([]);
    expect((await test.candidates.findByChunkId(test.organizationId, input.chunkId))?.assessment?.items[0]?.verdict).toBe("review");
  });

  it("keeps a supported entity without promoting its generic title as an alias", async () => {
    const test = await fixture();
    const content = "제갈량은 촉한의 승상이었다.";
    test.verify.mockResolvedValue({ model: "verifier", items: [{ item: "entity:p", support: "explicit", usefulness: "useful", conflict: false, evidence: content, reason: "Supported office." }],
      aliases: [{ entityKey: "p", alias: "승상", identity: "generic_reference", evidence: content, reason: "An office is not an alternative proper name." }] });
    const input = await test.extract(content, { entities: [{ key: "p", kind: "person", canonicalName: "제갈량", aliases: ["승상"] }], relationships: [] });
    await test.curate(test.organizationId, input.chunkId);
    const nodes = await test.graph.findNodesByNames(test.access, test.scope, ["제갈량"]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.aliases).toEqual([]);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["승상"])).toEqual([]);
    expect((await test.candidates.findByChunkId(test.organizationId, input.chunkId))?.assessment?.aliases?.[0]?.verdict).toBe("ignore");
  });

  it("does not revive an excluded alias when a human later accepts a relationship", async () => {
    const test = await fixture();
    const content = "제갈량은 승상이며 유비를 도왔다.";
    test.verify.mockResolvedValue({ model: "verifier", items: [
      { item: "entity:p", support: "explicit", usefulness: "useful", conflict: false, evidence: content, reason: "Supported identity." },
      { item: "entity:q", support: "explicit", usefulness: "useful", conflict: false, evidence: content, reason: "Supported identity." },
      { item: "relationship:0", support: "uncertain", usefulness: "useful", conflict: false, evidence: content, reason: "Review the relationship." }
    ], aliases: [{ entityKey: "p", alias: "승상", identity: "generic_reference", evidence: content, reason: "Shared title." }] });
    const input = await test.extract(content, { entities: [
      { key: "p", kind: "person", canonicalName: "제갈량", aliases: ["승상"] },
      { key: "q", kind: "person", canonicalName: "유비" }
    ], relationships: [{ sourceKey: "p", targetKey: "q", predicate: "helped" }] });
    await test.curate(test.organizationId, input.chunkId);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["승상"])).toEqual([]);
    const accept = buildAcceptKnowledgeCandidate({ repository: test.candidates, ontologyReader: createKnowledgeOntologyReader(db),
      generateId: randomUUID, clock: () => new Date() });
    await accept(test.access, input.candidate.id, "Verified relationship only", { entityKeys: [], relationshipIndexes: [0] });
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["승상"])).toEqual([]);
    const current = await test.candidates.findByChunkId(test.organizationId, input.chunkId);
    expect(current?.itemReviews?.find((review) => review.item === "entity:p")?.method).toBe("automatic");
  });

  it("keeps private, cross-organization and archived alias evidence outside public resolution", async () => {
    const test = await fixture(), other = await fixture();
    const privateScope: ScopedResource = { kind: "user", organizationId: test.organizationId, userId: test.userId };
    const origin = await test.source("Private identity statement.", privateScope);
    const privateNode = await test.graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope: privateScope, kind: "person", canonicalName: "Private Name", aliases: ["Hidden Alias"], source: { chunkId: origin.chunkId }, now: new Date() }));
    expect((await test.graph.findNodesByNames(test.access, privateScope, ["Hidden Alias"])).map((node) => node.id)).toEqual([privateNode.id]);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["Hidden Alias"])).toEqual([]);
    expect(await test.graph.findNodesByNames(other.access, privateScope, ["Hidden Alias"])).toEqual([]);
    expect(await test.graph.searchNodes({ access: other.access, query: "Hidden Alias", limit: 10 })).toEqual([]);
    const memberId = randomUUID();
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Member')", [memberId, `${memberId}@example.test`]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'member','active')", [test.organizationId, memberId]);
    const member: OrganizationAccess = { ...test.access, userId: memberId, role: "member" };
    expect(await test.graph.findNodesByNames(member, privateScope, ["Hidden Alias"])).toEqual([]);
    expect(await test.graph.searchNodes({ access: member, query: "Hidden Alias", limit: 10 })).toEqual([]);
    const node = await test.promote("Hidden Alias is a different person.", "Hidden Alias");
    expect(node.node.id).not.toBe(privateNode.id);
  });

  it("does not revive expired or future Memory aliases through another visible source", async () => {
    const test = await fixture();
    const memory = createMemory({ id: randomUUID(), kind: "fact", scope: test.scope, title: "Identity", content: "Primary is also called HiddenName.",
      source: { type: "user" }, createdBy: test.userId, validFrom: new Date(Date.now() - 60_000), now: new Date() });
    await createMemoryRepository(db).save(memory);
    const node = await test.graph.saveNode(createKnowledgeNode({ id: randomUUID(), canonicalName: "Primary", aliases: ["HiddenName"], kind: "person", scope: test.scope,
      source: { memoryId: memory.id }, now: new Date() }));
    const visible = await test.source("Primary has another supported fact.");
    await test.graph.saveNode(createKnowledgeNode({ id: randomUUID(), canonicalName: "Primary", kind: "person", scope: test.scope, source: { chunkId: visible.chunkId }, now: new Date() }));
    expect((await test.graph.findNodesByNames(test.access, test.scope, ["HiddenName"])).map((item) => item.id)).toEqual([node.id]);
    await pool.query("UPDATE memories SET expires_at=now() - interval '1 second' WHERE id=$1", [memory.id]);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["HiddenName"])).toEqual([]);
    expect(await test.graph.searchNodes({ access: test.access, query: "HiddenName", limit: 10 })).toEqual([]);
    expect((await test.graph.findNodesByNames(test.access, test.scope, ["Primary"]))[0]?.aliases).toEqual([]);
    await pool.query("UPDATE memories SET expires_at=NULL, valid_from=now() + interval '1 hour' WHERE id=$1", [memory.id]);
    expect(await test.graph.findNodesByNames(test.access, test.scope, ["HiddenName"])).toEqual([]);
  });
});
