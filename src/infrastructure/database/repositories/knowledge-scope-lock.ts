import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ScopedResource } from "@/domain/identity/organization-access";
import { scopeCovers } from "@/domain/identity/scope-coverage";
import type { KnowledgeSource } from "@/domain/knowledge/knowledge-graph";
import { KnowledgeScopeChangedError } from "@/domain/knowledge/knowledge-scope-change";
import type { AgentMemoryDatabase } from "../client";
import { documentChunks, documents, memories } from "../schema";
import { knowledgeScopeFromRow } from "./knowledge-node-persistence";

export type KnowledgeTransaction = Parameters<Parameters<AgentMemoryDatabase["transaction"]>[0]>[0];

export async function lockKnowledgeScope(transaction: KnowledgeTransaction, organizationId: string, exclusive = false) {
  const key = `knowledge-scope:${organizationId}`;
  await transaction.execute(exclusive
    ? sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    : sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`);
}

export const sourceKey = (source: KnowledgeSource) => source.memoryId ? `memory:${source.memoryId}` : `chunk:${source.chunkId}`;

export async function loadKnowledgeSourceScopes(transaction: KnowledgeTransaction, organizationId: string, sources: readonly KnowledgeSource[], now: Date) {
  const chunkIds = [...new Set(sources.flatMap((source) => source.chunkId ? [source.chunkId] : []))];
  const memoryIds = [...new Set(sources.flatMap((source) => source.memoryId ? [source.memoryId] : []))];
  const result = new Map<string, { scope: ScopedResource; available: boolean }>();
  if (chunkIds.length) {
    const rows = await transaction.select({ id: documentChunks.id, document: documents }).from(documentChunks)
      .innerJoin(documents, and(eq(documents.organizationId, documentChunks.organizationId), eq(documents.id, documentChunks.documentId)))
      .where(and(eq(documentChunks.organizationId, organizationId), inArray(documentChunks.id, chunkIds)))
      .orderBy(asc(documents.id), asc(documentChunks.id)).for("share", { of: documents });
    for (const row of rows) result.set(`chunk:${row.id}`, { scope: knowledgeScopeFromRow(row.document), available: row.document.status === "ready" });
  }
  if (memoryIds.length) {
    const rows = await transaction.select({
      id: memories.id, organizationId: memories.organizationId, scopeKind: memories.scopeKind,
      teamId: memories.teamId, userId: memories.userId, status: memories.status, validFrom: memories.validFrom, expiresAt: memories.expiresAt
    }).from(memories).where(and(eq(memories.organizationId, organizationId), inArray(memories.id, memoryIds)))
      .orderBy(asc(memories.id)).for("share");
    for (const row of rows) result.set(`memory:${row.id}`, {
      scope: knowledgeScopeFromRow(row), available: row.status === "active" && row.validFrom <= now && (!row.expiresAt || now < row.expiresAt)
    });
  }
  return result;
}

export async function assertKnowledgeSourceScopes(transaction: KnowledgeTransaction, scope: ScopedResource, sources: readonly KnowledgeSource[]) {
  const current = await loadKnowledgeSourceScopes(transaction, scope.organizationId, sources, new Date());
  if (sources.some((source) => {
    const record = current.get(sourceKey(source));
    return !record || !scopeCovers(record.scope, scope);
  })) throw new KnowledgeScopeChangedError();
}
