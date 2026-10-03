import { and, eq, isNull } from "drizzle-orm";
import type { KnowledgeEdge, KnowledgeEdgeContribution } from "@/domain/knowledge/knowledge-graph";
import { mergeKnowledgeProperties, type KnowledgePropertyContribution } from "@/domain/knowledge/knowledge-properties";
import type { AgentMemoryDatabase } from "../client";
import { knowledgeEdges } from "../schema";
import { knowledgeScopeFromRow } from "./knowledge-node-persistence";

type Transaction = Parameters<Parameters<AgentMemoryDatabase["transaction"]>[0]>[0];
type EdgeRow = typeof knowledgeEdges.$inferSelect;

export function edgeFromRow(row: EdgeRow, sources: readonly KnowledgePropertyContribution[]): KnowledgeEdge {
  if (sources.length === 0) throw new Error("knowledge edge has no provenance");
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope: knowledgeScopeFromRow(row),
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    predicate: row.predicate,
    properties: mergeKnowledgeProperties(sources),
    sources: sources.map((source) => source.memoryId ? { memoryId: source.memoryId } : { chunkId: source.chunkId! }),
    createdAt: row.createdAt
  };
}

/** The caller holds the organization's knowledge lock for this transaction. */
export async function findOrCreateKnowledgeEdge(transaction: Transaction, edge: KnowledgeEdgeContribution): Promise<EdgeRow> {
  const [inserted] = await transaction.insert(knowledgeEdges).values({
    id: edge.id, organizationId: edge.organizationId, scopeKind: edge.scope.kind,
    teamId: edge.scope.kind === "team" ? edge.scope.teamId : null,
    userId: edge.scope.kind === "user" ? edge.scope.userId : null,
    sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId,
    predicate: edge.predicate, createdAt: edge.createdAt
  }).onConflictDoNothing({ target: [knowledgeEdges.organizationId, knowledgeEdges.scopeKind,
    knowledgeEdges.teamId, knowledgeEdges.userId, knowledgeEdges.sourceNodeId,
    knowledgeEdges.predicate, knowledgeEdges.targetNodeId] }).returning();
  if (inserted) return inserted;
  const [existing] = await transaction.select().from(knowledgeEdges).where(and(
    eq(knowledgeEdges.organizationId, edge.organizationId), eq(knowledgeEdges.scopeKind, edge.scope.kind),
    edge.scope.kind === "team" ? eq(knowledgeEdges.teamId, edge.scope.teamId) : isNull(knowledgeEdges.teamId),
    edge.scope.kind === "user" ? eq(knowledgeEdges.userId, edge.scope.userId) : isNull(knowledgeEdges.userId),
    eq(knowledgeEdges.sourceNodeId, edge.sourceNodeId), eq(knowledgeEdges.targetNodeId, edge.targetNodeId),
    eq(knowledgeEdges.predicate, edge.predicate)
  )).limit(1);
  if (!existing) throw new Error("knowledge edge identity disappeared");
  return existing;
}
