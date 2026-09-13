import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Neo4jContainer, type StartedNeo4jContainer } from "@testcontainers/neo4j";
import neo4j, { type Driver } from "neo4j-driver";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type AgentMemoryDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeGraphProjection } from "@/infrastructure/database/repositories/knowledge-graph-projection";
import { createNeo4jKnowledgeTopologyStore } from "@/infrastructure/neo4j/knowledge-topology-store";
import { createKnowledgeNode, createKnowledgeEdge, type KnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { KnowledgeGraphUnavailableError, type KnowledgeTopologySnapshot } from "@/domain/knowledge/knowledge-topology";
import type { OrganizationAccess, ScopedResource } from "@/domain/identity/organization-access";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createEntityFirstKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-entity-first-extraction-service";
import { createKnowledgeVerificationService } from "@/infrastructure/ai/knowledge-verification-service";
import { buildGenerateKnowledgeCandidate } from "@/application/knowledge/generate-knowledge-candidate";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import { buildAcceptKnowledgeCandidate, buildRejectKnowledgeCandidate } from "@/application/knowledge/review-knowledge-candidate";

describe("Neo4j topology with PostgreSQL approval and provenance", () => {
  let postgres: StartedPostgreSqlContainer, graph: StartedNeo4jContainer, driver: Driver, pool: Pool, db: AgentMemoryDatabase;
  let store: ReturnType<typeof createNeo4jKnowledgeTopologyStore>;
  beforeAll(async () => {
    [postgres, graph] = await Promise.all([
      new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").withDatabase("neo4j_integration").withUsername("agent_memory").withPassword("agent_memory").start(),
      new Neo4jContainer("neo4j:2026.08.1").withPassword("agent_memory_test").start()
    ]);
    ({ db, pool } = createDatabase(postgres.getConnectionUri()));
    await initializeSchema(pool);
    driver = neo4j.driver(graph.getBoltUri(), neo4j.auth.basic(graph.getUsername(), graph.getPassword()));
    store = createNeo4jKnowledgeTopologyStore(driver, "neo4j");
    await store.initialize();
  });
  afterAll(async () => {
    await driver?.close();
    await pool?.end();
    await Promise.all([postgres?.stop(), graph?.stop()]);
  });

  async function fixture() {
    const organizationId = randomUUID(), userId = randomUUID();
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'Graph fixture')", [organizationId,organizationId]);
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Owner')", [userId, `${userId}@example.test`]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId,userId]);
    const scope: ScopedResource = { organizationId, kind: "organization" };
    const access: OrganizationAccess = { organizationId, userId, role: "owner", teams: [] };
    const projection = createKnowledgeGraphProjection(db, store);
    const repository = createKnowledgeGraphRepository(db, () => new Date(), projection);
    async function source(sourceScope = scope, content = "A uses B.") {
      const documentId = randomUUID(), chunkId = randomUUID();
      await pool.query("INSERT INTO documents(id,organization_id,scope_kind,user_id,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,$3,$4,'Topology source','test','test','text/plain','ready',$5)",
        [documentId,organizationId,sourceScope.kind,sourceScope.kind === "user" ? sourceScope.userId : null,userId]);
      await pool.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,$4)", [chunkId,organizationId,documentId,content]);
      return { documentId, chunkId };
    }
    const origin = await source();
    async function node(name: string, nodeScope = scope, chunkId = origin.chunkId) {
      return repository.saveNode(createKnowledgeNode({ id: randomUUID(), scope: nodeScope, kind: "service", canonicalName: name,
        source: { chunkId }, now: new Date() }), access);
    }
    async function edge(left: KnowledgeNode, right: KnowledgeNode, edgeScope = scope, chunkId = origin.chunkId) {
      return repository.saveEdge(createKnowledgeEdge({ id: randomUUID(), organizationId, scope: edgeScope, sourceNodeId: left.id,
        targetNodeId: right.id, predicate: "uses", source: { chunkId }, now: new Date() }));
    }
    return { organizationId, userId, access, scope, repository, projection, source, node, edge };
  }

  it("persists real Neo4j edges and follows multiple hops after approval, merge and deletion", async () => {
    const f = await fixture();
    const a = await f.node("A"), b = await f.node("B"), c = await f.node("C");
    await f.edge(a,b); await f.edge(b,c);
    expect(await store.revision(f.organizationId)).toBeUndefined();
    const first = await f.repository.findNeighborhood(f.access,a.id,2,100);
    expect(new Set(first.nodes.map((node) => node.id))).toEqual(new Set([a.id,b.id,c.id]));
    expect(first.edges).toHaveLength(2);
    const originalRevision = await store.revision(f.organizationId);
    expect((await driver.executeQuery("MATCH (:MemoryEntity {organizationId:$id})-[r:MEMORY_RELATION]->() RETURN count(r) AS count",
      { id:f.organizationId }, { database:"neo4j" })).records[0]!.get("count").toNumber()).toBe(2);
    await f.repository.mergeNodes({ organizationId:f.organizationId, sourceNodeId:b.id, targetNodeId:c.id, mergedBy:f.userId, reason:"Duplicate service", now:new Date() });
    const merged = await f.repository.findNeighborhood(f.access,a.id,2,100);
    expect(new Set(merged.nodes.map((node) => node.id))).toEqual(new Set([a.id,c.id]));
    expect(merged.edges).toHaveLength(1);
    expect(await store.revision(f.organizationId)).not.toBe(originalRevision);
    await f.repository.deleteNode(f.organizationId,c.id,f.scope);
    expect(await f.repository.findNeighborhood(f.access,a.id,2,100)).toMatchObject({ nodes:[{ id:a.id }], edges:[] });
    expect(await store.incidentEdgeIds(f.organizationId,[a.id],undefined,100)).toEqual([]);
  });

  it("promotes two-pass extraction through independent verification into a source-grounded Neo4j neighborhood", async () => {
    const f = await fixture();
    const content = "Atlas 서비스는 Neo4j 기술을 사용한다.";
    const source = await f.source(f.scope,content);
    const completion = (value:unknown) => Response.json({ choices:[{ message:{ content:JSON.stringify(value) } }] });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(completion({ entities:[
      { key:"atlas",kind:"service",canonicalName:"Atlas",summary:null,aliases:[],evidence:[content] },
      { key:"neo4j",kind:"technology",canonicalName:"Neo4j",summary:null,aliases:[],evidence:[content] }
    ] })).mockResolvedValueOnce(completion({ relationships:[{ sourceKey:"atlas",targetKey:"neo4j",predicate:"uses",evidence:[content] }] }));
    const candidates = createKnowledgeCandidateRepository(db), documents = createDocumentRepository(db), ontology = createKnowledgeOntologyReader(db);
    const clock = () => new Date();
    await buildGenerateKnowledgeCandidate({ candidateRepository:candidates,documentRepository:documents,ontologyReader:ontology,clock,generateId:randomUUID,
      extractionService:createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"extractor",request }) })(f.organizationId,source.chunkId);
    const verificationRequest = vi.fn<typeof fetch>().mockResolvedValue(completion({ items:Object.fromEntries(Object.entries({
      "entity:atlas":{ representation:"entity",entityKind:"service" },
      "entity:neo4j":{ representation:"entity",entityKind:"technology" },
      "relationship:0":{ representation:"relationship" }
    }).map(([item,identity]) => [item,{ ...identity,support:"explicit",usefulness:"useful",conflict:false,evidence:content,reason:"The source states this fact." }])) }));
    await buildCurateKnowledgeCandidate({ candidates,documents,ontology,clock,graph:f.repository,access:createOrganizationAccessRepository(db),
      verification:createKnowledgeVerificationService({ baseUrl:"http://verifier.test/v1",model:"verifier",request:verificationRequest }),
      accept:buildAcceptKnowledgeCandidate({ repository:candidates,ontologyReader:ontology,clock,generateId:randomUUID,method:"automatic" }),
      reject:buildRejectKnowledgeCandidate({ repository:candidates,clock,method:"automatic" }) })(f.organizationId,source.chunkId);
    const approved = await candidates.findByChunkId(f.organizationId,source.chunkId);
    expect(approved?.status).toBe("accepted");
    expect(approved?.assessment).toMatchObject({ model:"verifier",policyVersion:"evidence-v3" });
    expect(approved?.itemReviews?.every((item) => item.method === "automatic")).toBe(true);
    const [atlas] = await f.repository.findNodesByNames(f.access,f.scope,["Atlas"]);
    const result = await f.repository.findNeighborhood(f.access,atlas!.id,2,100);
    expect(result.nodes.map((node) => node.canonicalName).sort()).toEqual(["Atlas","Neo4j"]);
    expect(result.edges).toEqual([expect.objectContaining({ predicate:"uses",sources:[{ chunkId:source.chunkId }] })]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(verificationRequest).toHaveBeenCalledOnce();
  });

  it("rechecks archived provenance even if the Neo4j revision has not changed", async () => {
    const f = await fixture(), a = await f.node("A"), b = await f.node("B"), edgeSource = await f.source();
    await f.edge(a,b,f.scope,edgeSource.chunkId);
    expect((await f.repository.findNeighborhood(f.access,a.id,1,100)).edges).toHaveLength(1);
    const revision = await store.revision(f.organizationId);
    await pool.query("UPDATE documents SET status='archived' WHERE id=$1", [edgeSource.documentId]);
    expect(await f.repository.findNeighborhood(f.access,a.id,2,100)).toMatchObject({ nodes:[{ id:a.id }], edges:[] });
    expect(await store.revision(f.organizationId)).toBe(revision);
  });

  it("does not traverse a private bridge to expose another public node", async () => {
    const f = await fixture();
    const a = await f.node("Public A"), b = await f.node("Public B");
    const privateScope: ScopedResource = { organizationId:f.organizationId, kind:"user", userId:f.userId };
    const privateSource = await f.source(privateScope);
    const hidden = await f.node("Private bridge",privateScope,privateSource.chunkId);
    await f.edge(a,hidden,privateScope,privateSource.chunkId); await f.edge(hidden,b,privateScope,privateSource.chunkId);
    const viewer: OrganizationAccess = { ...f.access, userId:randomUUID(), role:"member" };
    expect(await f.repository.findNeighborhood(viewer,a.id,3,100)).toMatchObject({ nodes:[{ id:a.id }], edges:[] });
    expect((await f.repository.findNeighborhood(f.access,a.id,3,100)).nodes).toHaveLength(3);
  });

  it("paginates past stale Neo4j edges rather than hiding later readable results", async () => {
    const f = await fixture(), a = await f.node("A"), b = await f.node("B"), edge = await f.edge(a,b);
    await f.projection.prepare(f.organizationId);
    const revision = (await store.revision(f.organizationId))!;
    const stale = Array.from({ length:20 }, (_,index) => ({ id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,
      sourceNodeId:a.id, targetNodeId:b.id, predicate:"uses" }));
    await store.replace({ organizationId:f.organizationId, revision, nodes:[a,b], edges:[...stale,edge] });
    const result = await f.repository.findNeighborhood(f.access,a.id,1,2);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges.map((item) => item.id)).toEqual([edge.id]);
  });

  it("keeps the prior graph on replacement failure and isolates organizations sharing graph IDs", async () => {
    const first = randomUUID(), second = randomUUID();
    const snapshot: KnowledgeTopologySnapshot = { organizationId:first, revision:"first", nodes:[
      { id:"a",kind:"person",canonicalName:"A" }, { id:"b",kind:"person",canonicalName:"B" }
    ], edges:[{ id:"edge",sourceNodeId:"a",targetNodeId:"b",predicate:"knows" }] };
    await store.replace(snapshot);
    await store.replace({ ...snapshot, organizationId:second, revision:"second", edges:[] });
    expect(await store.incidentEdgeIds(second,["a"],undefined,10)).toEqual([]);
    await expect(store.replace({ ...snapshot, revision:"broken", edges:[{ ...snapshot.edges[0]!,targetNodeId:"missing" }] })).rejects.toThrow("missing endpoints");
    expect(await store.revision(first)).toBe("first");
    expect(await store.incidentEdgeIds(first,["a"],undefined,10)).toEqual(["edge"]);
  });

  it("recovers the committed ledger after an unavailable Neo4j without a partial approval", async () => {
    const f = await fixture(), a = await f.node("A"), b = await f.node("B");
    await f.edge(a,b);
    const unavailable = createKnowledgeGraphProjection(db,{ ...store, revision:async () => { throw new Error("connection unavailable"); } });
    await expect(unavailable.prepare(f.organizationId)).rejects.toBeInstanceOf(KnowledgeGraphUnavailableError);
    expect((await f.repository.findNeighborhood(f.access,a.id,1,100)).nodes).toHaveLength(2);
    const replace = vi.fn(store.replace);
    const projection = createKnowledgeGraphProjection(db,{ ...store, replace });
    await Promise.all([projection.prepare(f.organizationId),projection.prepare(f.organizationId)]);
    expect(replace).not.toHaveBeenCalled();
    await f.node("C");
    await Promise.all([projection.prepare(f.organizationId),projection.prepare(f.organizationId)]);
    expect(replace).toHaveBeenCalledOnce();
  });
});
