import { and, eq, isNull, sql } from "drizzle-orm";

import type { ScopedResource } from "@/domain/identity/organization-access";
import type {
  KnowledgeNode,
  KnowledgeNodeContribution
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeNodeIdentity } from "@/domain/knowledge/knowledge-graph-repository";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";
import { mergeKnowledgeDescriptions } from "@/domain/knowledge/knowledge-description";
import { knowledgeDisplayIdentity, knowledgeNameMap } from "@/domain/knowledge/knowledge-alias";
import { mergeKnowledgeProperties, type KnowledgePropertyContribution } from "@/domain/knowledge/knowledge-properties";

import type { AgentMemoryDatabase } from "../client";
import { knowledgeNodes, knowledgeNodeSources } from "../schema";

type AgentMemoryTransaction = Parameters<
  Parameters<AgentMemoryDatabase["transaction"]>[0]
>[0];
type NodeRow = typeof knowledgeNodes.$inferSelect;

// Public graph views use source metadata; vector scoring remains inside SQL.
export const knowledgeNodeSourceMetadataColumns = {
  id: knowledgeNodeSources.id,
  organizationId: knowledgeNodeSources.organizationId,
  nodeId: knowledgeNodeSources.nodeId,
  memoryId: knowledgeNodeSources.memoryId,
  chunkId: knowledgeNodeSources.chunkId,
  description: knowledgeNodeSources.description,
  names: knowledgeNodeSources.names,
  primaryNameKeys: knowledgeNodeSources.primaryNameKeys,
  properties: knowledgeNodeSources.properties,
  createdAt: knowledgeNodeSources.createdAt,
  updatedAt: knowledgeNodeSources.updatedAt
};

export interface KnowledgeSourceRecord extends KnowledgePropertyContribution {
  readonly description?: string;
  readonly names?: Readonly<Record<string, string>>;
  readonly primaryNameKeys?: readonly string[];
}

export function knowledgeSourceFromRow(row: {
  memoryId: string | null;
  chunkId: string | null;
  properties: Readonly<Record<string, unknown>>;
  updatedAt: Date;
  description?: string | null;
  names?: Readonly<Record<string, string>>;
  primaryNameKeys?: readonly string[];
}): KnowledgeSourceRecord {
  return { ...(row.memoryId ? { memoryId: row.memoryId } : { chunkId: row.chunkId! }),
    properties: row.properties, updatedAt: row.updatedAt,
    ...(row.names ? { names: row.names } : {}),
    ...(row.primaryNameKeys ? { primaryNameKeys: row.primaryNameKeys } : {}),
    ...(row.description ? { description: row.description } : {}) };
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
  sources: readonly KnowledgeSourceRecord[]
): KnowledgeNode {
  if (sources.length === 0) {
    throw new Error("knowledge node has no provenance");
  }
  const descriptions = sources.flatMap((source) => source.description ? [source.description] : []);
  const summary = mergeKnowledgeDescriptions(descriptions);
  return {
    id: row.id,
    scope: knowledgeScopeFromRow(row),
    kind: row.kind,
    ...knowledgeDisplayIdentity(row.canonicalName, sources.flatMap((source) => Object.values(source.names ?? {}))),
    ...(summary ? { summary } : {}),
    properties: mergeKnowledgeProperties(sources),
    sources: sources.map((source) => source.memoryId ? { memoryId: source.memoryId } : { chunkId: source.chunkId! }),
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
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  };
}

export function knowledgeNodeIdentityFromRow(row: NodeRow, sources: readonly KnowledgeSourceRecord[]): KnowledgeNodeIdentity {
  const primaryNames = new Set<string>();
  for (const source of sources) {
    if (!source.primaryNameKeys?.length) throw new Error("knowledge node source has no representative names");
    for (const key of source.primaryNameKeys) {
      if (!source.names || !Object.hasOwn(source.names, key)) throw new Error("knowledge node representative name has no source evidence");
      primaryNames.add(source.names[key]!);
    }
  }
  return { ...knowledgeNodeFromRow(row, sources), primaryNames: [...primaryNames].toSorted() };
}

function targetPredicate(node: KnowledgeNode, targetNodeId: string) {
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
    eq(knowledgeNodes.id, targetNodeId)
  );
}

/** The caller resolves visible names while holding the organization's exclusive knowledge lock. */
export async function saveKnowledgeNodeContribution(
  transaction: AgentMemoryTransaction,
  node: KnowledgeNodeContribution,
  propertyWrite: "replace" | "preserve",
  targetNodeId: string | null
): Promise<KnowledgeNode> {
  const values = knowledgeNodeValues(node);
  const [row] = targetNodeId !== null
    ? await transaction
        .update(knowledgeNodes)
        .set({
          updatedAt: values.updatedAt
        })
        .where(targetPredicate(node, targetNodeId))
        .returning()
    : await transaction
        .insert(knowledgeNodes)
        .values(values)
        .returning();
  if (!row) {
    throw new Error("resolved knowledge node is unavailable in the contribution scope");
  }
  const [source] = node.sources;
  await transaction
    .insert(knowledgeNodeSources)
    .values({
      organizationId: node.scope.organizationId,
      nodeId: row.id,
      memoryId: source.memoryId ?? null,
      chunkId: source.chunkId ?? null,
      description: node.summary ?? null,
      embedding: node.embedding?.values ?? null,
      embeddingModel: node.embedding?.model ?? null,
      names: knowledgeNameMap([node.canonicalName, ...node.aliases]),
      primaryNameKeys: [knowledgeCanonicalNameKey(node.canonicalName)],
      properties: node.properties,
      createdAt: node.updatedAt,
      updatedAt: node.updatedAt
    })
    .onConflictDoUpdate({
      target: [knowledgeNodeSources.organizationId, knowledgeNodeSources.nodeId, knowledgeNodeSources.memoryId, knowledgeNodeSources.chunkId],
      set: { description: sql`coalesce(excluded.description, ${knowledgeNodeSources.description})`,
        ...(node.embedding ? { embedding: sql`excluded.embedding`, embeddingModel: sql`excluded.embedding_model` } : {}),
        ...(propertyWrite === "replace" ? { properties: sql`excluded.properties`, updatedAt: node.updatedAt } : {}),
        names: sql`${knowledgeNodeSources.names} || excluded.names`,
        primaryNameKeys: sql`ARRAY(SELECT DISTINCT unnest(${knowledgeNodeSources.primaryNameKeys} || excluded.primary_name_keys))` }
    });
  const sourceRows = await transaction
    .select(knowledgeNodeSourceMetadataColumns)
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
