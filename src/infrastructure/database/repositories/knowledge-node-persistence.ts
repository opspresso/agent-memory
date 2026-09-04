import { and, eq, isNull, sql } from "drizzle-orm";

import type { ScopedResource } from "@/domain/identity/organization-access";
import type {
  KnowledgeNode,
  KnowledgeSource
} from "@/domain/knowledge/knowledge-graph";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";

import type { AgentMemoryDatabase } from "../client";
import { knowledgeNodes, knowledgeNodeSources } from "../schema";

type AgentMemoryTransaction = Parameters<
  Parameters<AgentMemoryDatabase["transaction"]>[0]
>[0];
type NodeRow = typeof knowledgeNodes.$inferSelect;

export function knowledgeSourceFromRow(row: {
  memoryId: string | null;
  chunkId: string | null;
}): KnowledgeSource {
  return row.memoryId ? { memoryId: row.memoryId } : { chunkId: row.chunkId! };
}

export function knowledgeScopeFromRow(row: {
  organizationId: string;
  scopeKind: "organization" | "team" | "user";
  teamId: string | null;
  userId: string | null;
}): ScopedResource {
  if (row.scopeKind === "team" && row.teamId) {
    return {
      kind: "team",
      organizationId: row.organizationId,
      teamId: row.teamId
    };
  }
  if (row.scopeKind === "user" && row.userId) {
    return {
      kind: "user",
      organizationId: row.organizationId,
      userId: row.userId
    };
  }
  return { kind: "organization", organizationId: row.organizationId };
}

export function knowledgeNodeFromRow(
  row: NodeRow,
  sources: readonly KnowledgeSource[]
): KnowledgeNode {
  if (sources.length === 0) {
    throw new Error("knowledge node has no provenance");
  }
  return {
    id: row.id,
    scope: knowledgeScopeFromRow(row),
    kind: row.kind,
    canonicalName: row.canonicalName,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.embedding && row.embeddingModel
      ? { embedding: { model: row.embeddingModel, values: row.embedding } }
      : {}),
    properties: row.properties,
    sources,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function knowledgeNodeValues(node: KnowledgeNode) {
  return {
    id: node.id,
    organizationId: node.scope.organizationId,
    scopeKind: node.scope.kind,
    teamId: node.scope.kind === "team" ? node.scope.teamId : null,
    userId: node.scope.kind === "user" ? node.scope.userId : null,
    kind: node.kind,
    canonicalName: node.canonicalName,
    summary: node.summary ?? null,
    embedding: node.embedding?.values ?? null,
    embeddingModel: node.embedding?.model ?? null,
    properties: node.properties,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  };
}

function vectorLiteral(values: readonly number[] | null | undefined) {
  return values ? `[${values.join(",")}]` : undefined;
}

function identityPredicate(node: KnowledgeNode) {
  return and(
    eq(knowledgeNodes.organizationId, node.scope.organizationId),
    eq(knowledgeNodes.scopeKind, node.scope.kind),
    node.scope.kind === "team"
      ? eq(knowledgeNodes.teamId, node.scope.teamId)
      : isNull(knowledgeNodes.teamId),
    node.scope.kind === "user"
      ? eq(knowledgeNodes.userId, node.scope.userId)
      : isNull(knowledgeNodes.userId),
    eq(knowledgeNodes.kind, node.kind),
    eq(
      knowledgeNodes.canonicalNameKey,
      knowledgeCanonicalNameKey(node.canonicalName)
    )
  );
}

export async function upsertKnowledgeNode(
  transaction: AgentMemoryTransaction,
  node: KnowledgeNode
): Promise<KnowledgeNode> {
  const values = knowledgeNodeValues(node);
  const identity = `${node.scope.organizationId}:${node.scope.kind}:${node.scope.kind === "team" ? node.scope.teamId : ""}:${node.scope.kind === "user" ? node.scope.userId : ""}:${node.kind}:${knowledgeCanonicalNameKey(node.canonicalName)}`;
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`
  );
  const [existing] = await transaction
    .select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .where(identityPredicate(node))
    .limit(1);
  const [row] = existing
    ? await transaction
        .update(knowledgeNodes)
        .set({
          summary: sql`coalesce(${values.summary}, ${knowledgeNodes.summary})`,
          embedding: values.embedding
            ? sql`coalesce(${vectorLiteral(values.embedding)}::vector, ${knowledgeNodes.embedding})`
            : knowledgeNodes.embedding,
          embeddingModel: sql`coalesce(${values.embeddingModel}, ${knowledgeNodes.embeddingModel})`,
          properties: sql`${knowledgeNodes.properties} || ${JSON.stringify(values.properties)}::jsonb`,
          updatedAt: values.updatedAt
        })
        .where(eq(knowledgeNodes.id, existing.id))
        .returning()
    : await transaction
        .insert(knowledgeNodes)
        .values(values)
        .onConflictDoUpdate({
          target: [
            knowledgeNodes.organizationId,
            knowledgeNodes.scopeKind,
            knowledgeNodes.teamId,
            knowledgeNodes.userId,
            knowledgeNodes.kind,
            knowledgeNodes.canonicalName
          ],
          set: {
            summary: sql`coalesce(excluded.summary, ${knowledgeNodes.summary})`,
            embedding: sql`coalesce(excluded.embedding, ${knowledgeNodes.embedding})`,
            embeddingModel: sql`coalesce(excluded.embedding_model, ${knowledgeNodes.embeddingModel})`,
            properties: sql`${knowledgeNodes.properties} || excluded.properties`,
            updatedAt: values.updatedAt
          }
        })
        .returning();
  if (!row) {
    throw new Error("knowledge node upsert returned no row");
  }
  for (const source of node.sources) {
    await transaction
      .insert(knowledgeNodeSources)
      .values({
        organizationId: node.scope.organizationId,
        nodeId: row.id,
        memoryId: source.memoryId ?? null,
        chunkId: source.chunkId ?? null,
        createdAt: node.updatedAt
      })
      .onConflictDoNothing();
  }
  const sourceRows = await transaction
    .select()
    .from(knowledgeNodeSources)
    .where(
      and(
        eq(knowledgeNodeSources.organizationId, node.scope.organizationId),
        eq(knowledgeNodeSources.nodeId, row.id)
      )
    );
  return knowledgeNodeFromRow(
    row,
    sourceRows.map(knowledgeSourceFromRow)
  );
}
