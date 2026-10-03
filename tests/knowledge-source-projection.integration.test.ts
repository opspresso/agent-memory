import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { createDatabase } from "@/infrastructure/database/client";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { knowledgeNodeFromRow, knowledgeNodeSourceMetadataColumns, knowledgeSourceFromRow } from "@/infrastructure/database/repositories/knowledge-node-persistence";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { documentChunks, knowledgeNodes, knowledgeNodeSources } from "@/infrastructure/database/schema";

describe("knowledge source metadata projection", () => {
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

  it("keeps graph views unchanged while avoiding vector hydration and preserving SQL scoring and merge data", async () => {
    const { db, pool } = database;
    const organizationId = randomUUID(), userId = randomUUID(), documentId = randomUUID(), nodeId = randomUUID();
    const now = new Date();
    const sourceCount = 32, dimensions = 4_096;
    const vector = Array.from({ length: dimensions }, (_, index) => Math.fround((index % 97 + 1) / 97));
    const access = { organizationId, userId, role: "owner" as const, teams: [] };
    const scope = { kind: "organization" as const, organizationId };
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'Projection fixture')", [organizationId, organizationId]);
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Reviewer')", [userId, `${userId}@example.test`]);
    await pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId, userId]);
    await pool.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization','Synthetic source','fixture','checksum','text/plain','ready',$3)", [documentId, organizationId, userId]);
    const [node] = await db.insert(knowledgeNodes).values({ id: nodeId, organizationId, scopeKind: "organization", kind: "service", canonicalName: "Atlas", createdAt: now, updatedAt: now }).returning();
    const chunks = Array.from({ length: sourceCount }, (_, ordinal) => ({ id: randomUUID(), organizationId, documentId, ordinal, content: "Atlas source evidence." }));
    await db.insert(documentChunks).values(chunks);
    await db.insert(knowledgeNodeSources).values(chunks.map((chunk, index) => ({
      organizationId, nodeId, chunkId: chunk.id, description: "Synthetic source evidence.",
      names: { atlas: "Atlas" }, primaryNameKeys: ["atlas"], properties: { sourceOrdinal: index },
      embedding: vector, embeddingModel: "projection-model", createdAt: now, updatedAt: new Date(now.getTime() + index)
    })));
    const predicate = and(eq(knowledgeNodeSources.organizationId, organizationId), eq(knowledgeNodeSources.nodeId, nodeId));
    const baseline = await db.select().from(knowledgeNodeSources).where(predicate).orderBy(knowledgeNodeSources.id);
    const projected = await db.select(knowledgeNodeSourceMetadataColumns).from(knowledgeNodeSources).where(predicate).orderBy(knowledgeNodeSources.id);
    const baselineBytes = Buffer.byteLength(JSON.stringify(baseline));
    const projectedBytes = Buffer.byteLength(JSON.stringify(projected));
    const baselineView = knowledgeNodeFromRow(node!, baseline.map(knowledgeSourceFromRow));
    const projectedView = knowledgeNodeFromRow(node!, projected.map(knowledgeSourceFromRow));
    expect(projectedView).toEqual(baselineView);
    expect(projected).toHaveLength(sourceCount);
    expect(projectedBytes).toBeLessThan(baselineBytes / 10);
    console.info(JSON.stringify({ fixture: "knowledge-source-projection", sourceCount, dimensions, baselineBytes, projectedBytes,
      reductionPercent: Number(((1 - projectedBytes / baselineBytes) * 100).toFixed(2)) }));

    const graph = createKnowledgeGraphRepository(db, () => now);
    const expected = { ...baselineView, sources: expect.arrayContaining([...baselineView.sources]) };
    expect(await graph.findNodeById(organizationId, nodeId)).toEqual(expected);
    expect((await graph.findNodesByNames(access, scope, ["Atlas"]))[0]).toMatchObject(expected);
    expect((await graph.findNeighborhood(access, nodeId, 1, 10)).nodes[0]).toEqual(expected);
    const semantic = await graph.searchNodes({ access, query: "unmatched", limit: 10,
      queryEmbedding: { model: "projection-model", values: vector } });
    expect(semantic[0]?.node).toEqual(expected);
    expect(semantic[0]?.vectorScore).toBeGreaterThan(0.99);

    const movedChunkId = randomUUID();
    await db.insert(documentChunks).values({ id: movedChunkId, organizationId, documentId, ordinal: sourceCount, content: "Atlas is also named Alias." });
    const alias = await graph.saveNode(createKnowledgeNode({ id: randomUUID(), scope, kind: "service", canonicalName: "Alias",
      embedding: { model: "projection-model", values: vector }, source: { chunkId: movedChunkId }, now }), access);
    await graph.mergeNodes({ organizationId, sourceNodeId: alias.id, targetNodeId: nodeId, mergedBy: userId, reason: "Verified identity", now });
    const [moved] = await db.select({ embedding: knowledgeNodeSources.embedding, model: knowledgeNodeSources.embeddingModel })
      .from(knowledgeNodeSources).where(and(eq(knowledgeNodeSources.nodeId, nodeId), eq(knowledgeNodeSources.chunkId, movedChunkId)));
    expect(moved?.model).toBe("projection-model");
    expect(moved?.embedding?.map(Math.fround)).toEqual(vector);
  });
});
