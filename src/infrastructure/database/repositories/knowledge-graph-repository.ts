import {
  and,
  desc,
  eq,
  inArray,
  or,
  sql,
  type SQL
} from "drizzle-orm";

import type {
  OrganizationAccess,
  ScopedResource
} from "@/domain/identity/organization-access";
import type {
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeSource
} from "@/domain/knowledge/knowledge-graph";
import type {
  KnowledgeGraphRepository,
  KnowledgeNodeSearchInput
} from "@/domain/knowledge/knowledge-graph-repository";

import type { AgentMemoryDatabase } from "../client";
import {
  documentChunks,
  documents,
  knowledgeEdges,
  knowledgeEdgeSources,
  knowledgeNodes,
  knowledgeNodeSources,
  memories,
  memoryAccessGrants
} from "../schema";
import { hybridSearchExpressions } from "./hybrid-search";

type NodeRow = typeof knowledgeNodes.$inferSelect;
type EdgeRow = typeof knowledgeEdges.$inferSelect;
type NodeSourceRow = typeof knowledgeNodeSources.$inferSelect;
type EdgeSourceRow = typeof knowledgeEdgeSources.$inferSelect;

function sourceFromRow(row: {
  memoryId: string | null;
  chunkId: string | null;
}): KnowledgeSource {
  return row.memoryId ? { memoryId: row.memoryId } : { chunkId: row.chunkId! };
}

function legacySources(row: {
  sourceMemoryId: string | null;
  sourceChunkId: string | null;
}): readonly KnowledgeSource[] {
  return row.sourceMemoryId
    ? [{ memoryId: row.sourceMemoryId }]
    : row.sourceChunkId
      ? [{ chunkId: row.sourceChunkId }]
      : [];
}

function scopeFromRow(row: {
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

export function nodeFromRow(
  row: NodeRow,
  sources: readonly KnowledgeSource[] = legacySources(row)
): KnowledgeNode {
  return {
    id: row.id,
    scope: scopeFromRow(row),
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

export function edgeFromRow(
  row: EdgeRow,
  sources: readonly KnowledgeSource[] = legacySources(row)
): KnowledgeEdge {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope: scopeFromRow(row),
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    predicate: row.predicate,
    properties: row.properties,
    sources,
    createdAt: row.createdAt
  };
}

function nodeAccessPredicate(access: OrganizationAccess): SQL {
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(knowledgeNodes.scopeKind, "organization"),
    and(
      eq(knowledgeNodes.scopeKind, "user"),
      eq(knowledgeNodes.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(knowledgeNodes.scopeKind, "team"),
          inArray(knowledgeNodes.teamId, teamIds)
        )
      : undefined
  )!;
}

function edgeAccessPredicate(access: OrganizationAccess): SQL {
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(knowledgeEdges.scopeKind, "organization"),
    and(
      eq(knowledgeEdges.scopeKind, "user"),
      eq(knowledgeEdges.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(knowledgeEdges.scopeKind, "team"),
          inArray(knowledgeEdges.teamId, teamIds)
        )
      : undefined
  )!;
}

function memorySourceAccessPredicate(access: OrganizationAccess): SQL {
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  const grantPredicate = or(
    and(
      eq(memoryAccessGrants.principalKind, "user"),
      eq(memoryAccessGrants.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(memoryAccessGrants.principalKind, "team"),
          inArray(memoryAccessGrants.teamId, teamIds)
        )
      : undefined
  );
  return or(
    eq(memories.scopeKind, "organization"),
    and(eq(memories.scopeKind, "user"), eq(memories.userId, access.userId)),
    teamIds.length > 0
      ? and(eq(memories.scopeKind, "team"), inArray(memories.teamId, teamIds))
      : undefined,
    sql`EXISTS (
      SELECT 1 FROM ${memoryAccessGrants}
      WHERE ${memoryAccessGrants.organizationId} = ${memories.organizationId}
        AND ${memoryAccessGrants.memoryId} = ${memories.id}
        AND ${grantPredicate}
    )`
  )!;
}

function documentSourceAccessPredicate(access: OrganizationAccess): SQL {
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(documents.scopeKind, "organization"),
    and(eq(documents.scopeKind, "user"), eq(documents.userId, access.userId)),
    teamIds.length > 0
      ? and(eq(documents.scopeKind, "team"), inArray(documents.teamId, teamIds))
      : undefined
  )!;
}

function nodeHasVisibleSource(access: OrganizationAccess): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${knowledgeNodeSources}
    LEFT JOIN ${memories}
      ON ${memories.organizationId} = ${knowledgeNodeSources.organizationId}
     AND ${memories.id} = ${knowledgeNodeSources.memoryId}
    LEFT JOIN ${documentChunks}
      ON ${documentChunks.organizationId} = ${knowledgeNodeSources.organizationId}
     AND ${documentChunks.id} = ${knowledgeNodeSources.chunkId}
    LEFT JOIN ${documents}
      ON ${documents.organizationId} = ${documentChunks.organizationId}
     AND ${documents.id} = ${documentChunks.documentId}
    WHERE ${knowledgeNodeSources.organizationId} = ${knowledgeNodes.organizationId}
      AND ${knowledgeNodeSources.nodeId} = ${knowledgeNodes.id}
      AND (
        (${knowledgeNodeSources.memoryId} IS NOT NULL
          AND ${memories.status} = 'active'
          AND ${memories.validFrom} <= CURRENT_TIMESTAMP
          AND (${memories.expiresAt} IS NULL OR ${memories.expiresAt} > CURRENT_TIMESTAMP)
          AND ${memorySourceAccessPredicate(access)})
        OR
        (${knowledgeNodeSources.chunkId} IS NOT NULL
          AND ${documents.status} = 'ready'
          AND ${documentSourceAccessPredicate(access)})
      )
  )`;
}

function edgeHasVisibleSource(access: OrganizationAccess): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${knowledgeEdgeSources}
    LEFT JOIN ${memories}
      ON ${memories.organizationId} = ${knowledgeEdgeSources.organizationId}
     AND ${memories.id} = ${knowledgeEdgeSources.memoryId}
    LEFT JOIN ${documentChunks}
      ON ${documentChunks.organizationId} = ${knowledgeEdgeSources.organizationId}
     AND ${documentChunks.id} = ${knowledgeEdgeSources.chunkId}
    LEFT JOIN ${documents}
      ON ${documents.organizationId} = ${documentChunks.organizationId}
     AND ${documents.id} = ${documentChunks.documentId}
    WHERE ${knowledgeEdgeSources.organizationId} = ${knowledgeEdges.organizationId}
      AND ${knowledgeEdgeSources.edgeId} = ${knowledgeEdges.id}
      AND (
        (${knowledgeEdgeSources.memoryId} IS NOT NULL
          AND ${memories.status} = 'active'
          AND ${memories.validFrom} <= CURRENT_TIMESTAMP
          AND (${memories.expiresAt} IS NULL OR ${memories.expiresAt} > CURRENT_TIMESTAMP)
          AND ${memorySourceAccessPredicate(access)})
        OR
        (${knowledgeEdgeSources.chunkId} IS NOT NULL
          AND ${documents.status} = 'ready'
          AND ${documentSourceAccessPredicate(access)})
      )
  )`;
}

export function nodeValues(node: KnowledgeNode) {
  const source = node.sources[0];
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
    sourceMemoryId: source?.memoryId ?? null,
    sourceChunkId: source?.chunkId ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  };
}

export function edgeValues(edge: KnowledgeEdge) {
  const source = edge.sources[0];
  return {
    id: edge.id,
    organizationId: edge.organizationId,
    scopeKind: edge.scope.kind,
    teamId: edge.scope.kind === "team" ? edge.scope.teamId : null,
    userId: edge.scope.kind === "user" ? edge.scope.userId : null,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    predicate: edge.predicate,
    properties: edge.properties,
    sourceMemoryId: source?.memoryId ?? null,
    sourceChunkId: source?.chunkId ?? null,
    createdAt: edge.createdAt
  };
}

function sourcesByResourceId<T extends NodeSourceRow | EdgeSourceRow>(
  rows: readonly T[],
  resourceIdFor: (row: T) => string
): Map<string, KnowledgeSource[]> {
  const result = new Map<string, KnowledgeSource[]>();
  for (const row of rows) {
    const resourceId = resourceIdFor(row);
    const sources = result.get(resourceId) ?? [];
    sources.push(sourceFromRow(row));
    result.set(resourceId, sources);
  }
  return result;
}

function scoreExpressions(input: KnowledgeNodeSearchInput) {
  return hybridSearchExpressions({
    search: knowledgeNodes.search,
    embedding: knowledgeNodes.embedding,
    embeddingModel: knowledgeNodes.embeddingModel,
    query: input.query,
    ...(input.queryEmbedding ? { queryEmbedding: input.queryEmbedding } : {})
  });
}

export function createKnowledgeGraphRepository(
  db: AgentMemoryDatabase
): KnowledgeGraphRepository {
  return {
    async saveNode(node) {
      const values = nodeValues(node);
      return db.transaction(async (transaction) => {
        const [row] = await transaction
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
        return nodeFromRow(
          row,
          sourceRows.length > 0
            ? sourceRows.map(sourceFromRow)
            : legacySources(row)
        );
      });
    },

    async findNodeById(organizationId, nodeId) {
      const [row] = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, organizationId),
            eq(knowledgeNodes.id, nodeId)
          )
        )
        .limit(1);
      if (!row) {
        return null;
      }
      const sourceRows = await db
        .select()
        .from(knowledgeNodeSources)
        .where(
          and(
            eq(knowledgeNodeSources.organizationId, organizationId),
            eq(knowledgeNodeSources.nodeId, row.id)
          )
        );
      return nodeFromRow(
        row,
        sourceRows.length > 0 ? sourceRows.map(sourceFromRow) : legacySources(row)
      );
    },

    async saveEdge(edge) {
      const values = edgeValues(edge);
      return db.transaction(async (transaction) => {
        const [row] = await transaction
          .insert(knowledgeEdges)
          .values(values)
          .onConflictDoUpdate({
          target: [
            knowledgeEdges.organizationId,
            knowledgeEdges.scopeKind,
            knowledgeEdges.teamId,
            knowledgeEdges.userId,
            knowledgeEdges.sourceNodeId,
            knowledgeEdges.predicate,
            knowledgeEdges.targetNodeId
          ],
            set: {
              properties: sql`${knowledgeEdges.properties} || excluded.properties`
            }
          })
          .returning();
        if (!row) {
          throw new Error("knowledge edge upsert returned no row");
        }
        for (const source of edge.sources) {
          await transaction
            .insert(knowledgeEdgeSources)
            .values({
              organizationId: edge.organizationId,
              edgeId: row.id,
              memoryId: source.memoryId ?? null,
              chunkId: source.chunkId ?? null,
              createdAt: edge.createdAt
            })
            .onConflictDoNothing();
        }
        const sourceRows = await transaction
          .select()
          .from(knowledgeEdgeSources)
          .where(
            and(
              eq(knowledgeEdgeSources.organizationId, edge.organizationId),
              eq(knowledgeEdgeSources.edgeId, row.id)
            )
          );
        return edgeFromRow(
          row,
          sourceRows.length > 0
            ? sourceRows.map(sourceFromRow)
            : legacySources(row)
        );
      });
    },

    async searchNodes(input) {
      const scores = scoreExpressions(input);
      const rows = await db
        .select({
          node: knowledgeNodes,
          lexicalScore: scores.lexicalScore,
          vectorScore: scores.vectorScore,
          score: scores.score
        })
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, input.access.organizationId),
            nodeAccessPredicate(input.access),
            nodeHasVisibleSource(input.access),
            scores.matches
          )
        )
        .orderBy(desc(scores.score), knowledgeNodes.canonicalName)
        .limit(input.limit);
      const sourceRows = rows.length > 0
        ? await db
            .select()
            .from(knowledgeNodeSources)
            .where(
              and(
                eq(
                  knowledgeNodeSources.organizationId,
                  input.access.organizationId
                ),
                inArray(
                  knowledgeNodeSources.nodeId,
                  rows.map((row) => row.node.id)
                )
              )
            )
        : [];
      const sources = sourcesByResourceId(sourceRows, (row) => row.nodeId);
      return rows.map((row) => ({
        node: nodeFromRow(
          row.node,
          sources.get(row.node.id) ?? legacySources(row.node)
        ),
        lexicalScore: row.lexicalScore,
        vectorScore: row.vectorScore,
        score: row.score
      }));
    },

    async findNeighborhood(access, nodeId, depth, limit) {
      const rootRows = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, access.organizationId),
            eq(knowledgeNodes.id, nodeId),
            nodeAccessPredicate(access),
            nodeHasVisibleSource(access)
          )
        )
        .limit(1);
      const root = rootRows[0];
      if (!root) {
        return { nodes: [], edges: [] };
      }

      const nodesById = new Map([[root.id, root]]);
      const edgesById = new Map<string, EdgeRow>();
      let frontier = [root.id];
      for (let level = 0; level < depth && frontier.length > 0; level += 1) {
        const edgeRows = await db
          .select()
          .from(knowledgeEdges)
          .where(
            and(
              eq(knowledgeEdges.organizationId, access.organizationId),
              edgeAccessPredicate(access),
              edgeHasVisibleSource(access),
              or(
                inArray(knowledgeEdges.sourceNodeId, frontier),
                inArray(knowledgeEdges.targetNodeId, frontier)
              )
            )
          )
          .limit(limit * 4);
        const candidateIds = new Set<string>();
        for (const edge of edgeRows) {
          edgesById.set(edge.id, edge);
          if (!nodesById.has(edge.sourceNodeId)) {
            candidateIds.add(edge.sourceNodeId);
          }
          if (!nodesById.has(edge.targetNodeId)) {
            candidateIds.add(edge.targetNodeId);
          }
        }
        const remaining = limit - nodesById.size;
        if (candidateIds.size === 0 || remaining <= 0) {
          break;
        }
        const nextRows = await db
          .select()
          .from(knowledgeNodes)
          .where(
            and(
              eq(knowledgeNodes.organizationId, access.organizationId),
              inArray(knowledgeNodes.id, [...candidateIds]),
              nodeAccessPredicate(access),
              nodeHasVisibleSource(access)
            )
          )
          .limit(remaining);
        frontier = nextRows.map((row) => row.id);
        for (const row of nextRows) {
          nodesById.set(row.id, row);
        }
      }

      const nodeRows = [...nodesById.values()];
      const edgeRows = [...edgesById.values()].filter(
        (edge) =>
          nodesById.has(edge.sourceNodeId) &&
          nodesById.has(edge.targetNodeId)
      );
      const [nodeSourceRows, edgeSourceRows] = await Promise.all([
        db
          .select()
          .from(knowledgeNodeSources)
          .where(
            and(
              eq(knowledgeNodeSources.organizationId, access.organizationId),
              inArray(knowledgeNodeSources.nodeId, nodeRows.map((row) => row.id))
            )
          ),
        edgeRows.length > 0
          ? db
              .select()
              .from(knowledgeEdgeSources)
              .where(
                and(
                  eq(
                    knowledgeEdgeSources.organizationId,
                    access.organizationId
                  ),
                  inArray(
                    knowledgeEdgeSources.edgeId,
                    edgeRows.map((row) => row.id)
                  )
                )
              )
          : Promise.resolve([])
      ]);
      const nodeSources = sourcesByResourceId(nodeSourceRows, (row) => row.nodeId);
      const edgeSources = sourcesByResourceId(edgeSourceRows, (row) => row.edgeId);
      return {
        nodes: nodeRows.map((row) =>
          nodeFromRow(row, nodeSources.get(row.id) ?? legacySources(row))
        ),
        edges: edgeRows
          .map((row) =>
            edgeFromRow(row, edgeSources.get(row.id) ?? legacySources(row))
          )
      };
    }
  };
}
