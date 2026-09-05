import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
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
  KnowledgeSource
} from "@/domain/knowledge/knowledge-graph";
import type {
  KnowledgeGraphRepository,
  KnowledgeNodeSearchInput
} from "@/domain/knowledge/knowledge-graph-repository";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";

import type { AgentMemoryDatabase } from "../client";
import {
  documentChunks,
  documents,
  knowledgeCandidateEdges,
  knowledgeCandidateNodes,
  knowledgeEdges,
  knowledgeEdgeSources,
  knowledgeNodeMerges,
  knowledgeNodes,
  knowledgeNodeSources,
  memories
} from "../schema";
import { hybridSearchExpressions } from "./hybrid-search";
import {
  memoryReadPredicate,
  scopedReadPredicate
} from "./scope-predicates";
import {
  knowledgeNodeFromRow,
  knowledgeScopeFromRow,
  knowledgeSourceFromRow,
  upsertKnowledgeNode
} from "./knowledge-node-persistence";

type EdgeRow = typeof knowledgeEdges.$inferSelect;
type NodeSourceRow = typeof knowledgeNodeSources.$inferSelect;
type EdgeSourceRow = typeof knowledgeEdgeSources.$inferSelect;

export function edgeFromRow(
  row: EdgeRow,
  sources: readonly KnowledgeSource[]
): KnowledgeEdge {
  if (sources.length === 0) {
    throw new Error("knowledge edge has no provenance");
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope: knowledgeScopeFromRow(row),
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    predicate: row.predicate,
    properties: row.properties,
    sources,
    createdAt: row.createdAt
  };
}

function nodeAccessPredicate(access: OrganizationAccess): SQL {
  return scopedReadPredicate(access, knowledgeNodes);
}

function edgeAccessPredicate(access: OrganizationAccess): SQL {
  return scopedReadPredicate(access, knowledgeEdges);
}

function documentSourceAccessPredicate(access: OrganizationAccess): SQL {
  return scopedReadPredicate(access, documents);
}

function visibleSourcePredicate(
  access: OrganizationAccess,
  sources: typeof knowledgeNodeSources | typeof knowledgeEdgeSources
): SQL {
  return sql`(
    EXISTS (
      SELECT 1 FROM ${memories}
      WHERE ${memories.organizationId} = ${sources.organizationId}
        AND ${memories.id} = ${sources.memoryId}
        AND ${memories.status} = 'active'
        AND ${memories.validFrom} <= CURRENT_TIMESTAMP
        AND (${memories.expiresAt} IS NULL OR ${memories.expiresAt} > CURRENT_TIMESTAMP)
        AND ${memoryReadPredicate(access)}
    ) OR EXISTS (
      SELECT 1 FROM ${documentChunks}
      JOIN ${documents}
        ON ${documents.organizationId} = ${documentChunks.organizationId}
       AND ${documents.id} = ${documentChunks.documentId}
      WHERE ${documentChunks.organizationId} = ${sources.organizationId}
        AND ${documentChunks.id} = ${sources.chunkId}
        AND ${documents.status} = 'ready'
        AND ${documentSourceAccessPredicate(access)}
    )
  )`;
}

function nodeHasVisibleSource(access: OrganizationAccess): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${knowledgeNodeSources}
    WHERE ${knowledgeNodeSources.organizationId} = ${knowledgeNodes.organizationId}
      AND ${knowledgeNodeSources.nodeId} = ${knowledgeNodes.id}
      AND ${visibleSourcePredicate(access, knowledgeNodeSources)}
  )`;
}

function edgeHasVisibleSource(access: OrganizationAccess): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${knowledgeEdgeSources}
    WHERE ${knowledgeEdgeSources.organizationId} = ${knowledgeEdges.organizationId}
      AND ${knowledgeEdgeSources.edgeId} = ${knowledgeEdges.id}
      AND ${visibleSourcePredicate(access, knowledgeEdgeSources)}
  )`;
}

export function edgeValues(edge: KnowledgeEdge) {
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
    sources.push(knowledgeSourceFromRow(row));
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

function vectorLiteral(values: readonly number[] | null | undefined) {
  return values ? `[${values.join(",")}]` : undefined;
}

function nodeScopePredicate(scope: ScopedResource) {
  return and(
    eq(knowledgeNodes.organizationId, scope.organizationId),
    eq(knowledgeNodes.scopeKind, scope.kind),
    scope.kind === "team"
      ? eq(knowledgeNodes.teamId, scope.teamId)
      : isNull(knowledgeNodes.teamId),
    scope.kind === "user"
      ? eq(knowledgeNodes.userId, scope.userId)
      : isNull(knowledgeNodes.userId)
  );
}

export function createKnowledgeGraphRepository(
  db: AgentMemoryDatabase
): KnowledgeGraphRepository {
  return {
    async saveNode(node) {
      return db.transaction((transaction) =>
        upsertKnowledgeNode(transaction, node)
      );
    },

    async findNodesByCanonicalNames(access, scope, canonicalNames) {
      const canonicalNameKeys = [
        ...new Set(canonicalNames.map(knowledgeCanonicalNameKey))
      ];
      if (canonicalNameKeys.length === 0) {
        return [];
      }
      const rows = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, access.organizationId),
            nodeScopePredicate(scope),
            nodeAccessPredicate(access),
            nodeHasVisibleSource(access),
            inArray(knowledgeNodes.canonicalNameKey, canonicalNameKeys)
          )
        )
        .orderBy(asc(knowledgeNodes.canonicalName), asc(knowledgeNodes.kind));
      const sourceRows = rows.length > 0
        ? await db
            .select()
            .from(knowledgeNodeSources)
            .where(
              and(
                eq(knowledgeNodeSources.organizationId, access.organizationId),
                visibleSourcePredicate(access, knowledgeNodeSources),
                inArray(
                  knowledgeNodeSources.nodeId,
                  rows.map((row) => row.id)
                )
              )
            )
        : [];
      const sources = sourcesByResourceId(sourceRows, (row) => row.nodeId);
      return rows.filter((row) => sources.has(row.id)).map((row) =>
        knowledgeNodeFromRow(
          row,
          sources.get(row.id) ?? []
        )
      );
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
      return knowledgeNodeFromRow(
        row,
        sourceRows.map(knowledgeSourceFromRow)
      );
    },

    async deleteNode(organizationId, nodeId) {
      const [deleted] = await db
        .delete(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, organizationId),
            eq(knowledgeNodes.id, nodeId)
          )
        )
        .returning({ id: knowledgeNodes.id });
      return deleted !== undefined;
    },

    async mergeNodes(input) {
      return db.transaction(async (transaction) => {
        const locked = await transaction
          .select()
          .from(knowledgeNodes)
          .where(
            and(
              eq(knowledgeNodes.organizationId, input.organizationId),
              inArray(knowledgeNodes.id, [
                input.sourceNodeId,
                input.targetNodeId
              ])
            )
          )
          .orderBy(asc(knowledgeNodes.id))
          .for("update");
        const source = locked.find((row) => row.id === input.sourceNodeId);
        const target = locked.find((row) => row.id === input.targetNodeId);
        if (!source || !target || source.id === target.id) {
          return null;
        }
        if (
          source.scopeKind !== target.scopeKind ||
          source.teamId !== target.teamId ||
          source.userId !== target.userId
        ) {
          return null;
        }

        const sourceNodeSourceRows = await transaction
          .select()
          .from(knowledgeNodeSources)
          .where(
            and(
              eq(knowledgeNodeSources.organizationId, input.organizationId),
              eq(knowledgeNodeSources.nodeId, source.id)
            )
          );
        const sourcesToMove = knowledgeNodeFromRow(
          source,
          sourceNodeSourceRows.map(knowledgeSourceFromRow)
        ).sources;
        for (const sourceReference of sourcesToMove) {
          await transaction
            .insert(knowledgeNodeSources)
            .values({
              organizationId: input.organizationId,
              nodeId: target.id,
              memoryId: sourceReference.memoryId ?? null,
              chunkId: sourceReference.chunkId ?? null,
              createdAt: input.now
            })
            .onConflictDoNothing();
        }

        const connectedEdges = await transaction
          .select()
          .from(knowledgeEdges)
          .where(
            and(
              eq(knowledgeEdges.organizationId, input.organizationId),
              or(
                eq(knowledgeEdges.sourceNodeId, source.id),
                eq(knowledgeEdges.targetNodeId, source.id)
              )
            )
          )
          .for("update");
        for (const edge of connectedEdges) {
          const nextSourceNodeId =
            edge.sourceNodeId === source.id ? target.id : edge.sourceNodeId;
          const nextTargetNodeId =
            edge.targetNodeId === source.id ? target.id : edge.targetNodeId;
          if (nextSourceNodeId === nextTargetNodeId) {
            await transaction
              .delete(knowledgeEdges)
              .where(eq(knowledgeEdges.id, edge.id));
            continue;
          }
          const [existingEdge] = await transaction
            .select()
            .from(knowledgeEdges)
            .where(
              and(
                eq(knowledgeEdges.organizationId, input.organizationId),
                ne(knowledgeEdges.id, edge.id),
                eq(knowledgeEdges.scopeKind, edge.scopeKind),
                edge.teamId
                  ? eq(knowledgeEdges.teamId, edge.teamId)
                  : isNull(knowledgeEdges.teamId),
                edge.userId
                  ? eq(knowledgeEdges.userId, edge.userId)
                  : isNull(knowledgeEdges.userId),
                eq(knowledgeEdges.sourceNodeId, nextSourceNodeId),
                eq(knowledgeEdges.targetNodeId, nextTargetNodeId),
                eq(knowledgeEdges.predicate, edge.predicate)
              )
            )
            .for("update")
            .limit(1);
          if (existingEdge) {
            const sourceRows = await transaction
              .select()
              .from(knowledgeEdgeSources)
              .where(
                and(
                  eq(
                    knowledgeEdgeSources.organizationId,
                    input.organizationId
                  ),
                  eq(knowledgeEdgeSources.edgeId, edge.id)
                )
              );
            const edgeSources = edgeFromRow(
              edge,
              sourceRows.map(knowledgeSourceFromRow)
            ).sources;
            for (const sourceReference of edgeSources) {
              await transaction
                .insert(knowledgeEdgeSources)
                .values({
                  organizationId: input.organizationId,
                  edgeId: existingEdge.id,
                  memoryId: sourceReference.memoryId ?? null,
                  chunkId: sourceReference.chunkId ?? null,
                  createdAt: input.now
                })
                .onConflictDoNothing();
            }
            const candidateEdges = await transaction
              .select({ candidateId: knowledgeCandidateEdges.candidateId })
              .from(knowledgeCandidateEdges)
              .where(
                and(
                  eq(
                    knowledgeCandidateEdges.organizationId,
                    input.organizationId
                  ),
                  eq(knowledgeCandidateEdges.edgeId, edge.id)
                )
              );
            for (const candidateEdge of candidateEdges) {
              await transaction
                .insert(knowledgeCandidateEdges)
                .values({
                  organizationId: input.organizationId,
                  candidateId: candidateEdge.candidateId,
                  edgeId: existingEdge.id,
                  createdAt: input.now
                })
                .onConflictDoNothing();
            }
            await transaction
              .update(knowledgeEdges)
              .set({
                properties: sql`${JSON.stringify(edge.properties)}::jsonb || ${JSON.stringify(existingEdge.properties)}::jsonb`
              })
              .where(eq(knowledgeEdges.id, existingEdge.id));
            await transaction
              .delete(knowledgeEdges)
              .where(eq(knowledgeEdges.id, edge.id));
          } else {
            await transaction
              .update(knowledgeEdges)
              .set({
                sourceNodeId: nextSourceNodeId,
                targetNodeId: nextTargetNodeId
              })
              .where(eq(knowledgeEdges.id, edge.id));
          }
        }

        const [merged] = await transaction
          .update(knowledgeNodes)
          .set({
            summary: sql`coalesce(${knowledgeNodes.summary}, ${source.summary})`,
            embedding: source.embedding
              ? sql`coalesce(${knowledgeNodes.embedding}, ${vectorLiteral(source.embedding)}::vector)`
              : knowledgeNodes.embedding,
            embeddingModel: sql`coalesce(${knowledgeNodes.embeddingModel}, ${source.embeddingModel})`,
            properties: sql`${JSON.stringify(source.properties)}::jsonb || ${knowledgeNodes.properties}`,
            updatedAt: input.now
          })
          .where(eq(knowledgeNodes.id, target.id))
          .returning();
        if (!merged) {
          throw new Error("knowledge node merge target disappeared");
        }
        const candidateNodes = await transaction
          .select({ candidateId: knowledgeCandidateNodes.candidateId })
          .from(knowledgeCandidateNodes)
          .where(
            and(
              eq(
                knowledgeCandidateNodes.organizationId,
                input.organizationId
              ),
              eq(knowledgeCandidateNodes.nodeId, source.id)
            )
          );
        for (const candidateNode of candidateNodes) {
          await transaction
            .insert(knowledgeCandidateNodes)
            .values({
              organizationId: input.organizationId,
              candidateId: candidateNode.candidateId,
              nodeId: target.id,
              createdAt: input.now
            })
            .onConflictDoNothing();
        }
        await transaction
          .insert(knowledgeNodeMerges)
          .values({
            organizationId: input.organizationId,
            sourceNodeId: source.id,
            targetNodeId: target.id,
            sourceKind: source.kind,
            sourceCanonicalName: source.canonicalName,
            mergedBy: input.mergedBy,
            reason: input.reason,
            createdAt: input.now
          });
        await transaction
          .delete(knowledgeNodes)
          .where(eq(knowledgeNodes.id, source.id));

        const targetSources = await transaction
          .select()
          .from(knowledgeNodeSources)
          .where(
            and(
              eq(knowledgeNodeSources.organizationId, input.organizationId),
              eq(knowledgeNodeSources.nodeId, target.id)
            )
          );
        return knowledgeNodeFromRow(
          merged,
          targetSources.map(knowledgeSourceFromRow)
        );
      });
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
          sourceRows.map(knowledgeSourceFromRow)
        );
      });
    },

    async findEdgeById(organizationId, edgeId) {
      const [row] = await db
        .select()
        .from(knowledgeEdges)
        .where(
          and(
            eq(knowledgeEdges.organizationId, organizationId),
            eq(knowledgeEdges.id, edgeId)
          )
        )
        .limit(1);
      if (!row) {
        return null;
      }
      const sourceRows = await db
        .select()
        .from(knowledgeEdgeSources)
        .where(
          and(
            eq(knowledgeEdgeSources.organizationId, organizationId),
            eq(knowledgeEdgeSources.edgeId, row.id)
          )
        );
      return edgeFromRow(
        row,
        sourceRows.map(knowledgeSourceFromRow)
      );
    },

    async deleteEdge(organizationId, edgeId) {
      const [deleted] = await db
        .delete(knowledgeEdges)
        .where(
          and(
            eq(knowledgeEdges.organizationId, organizationId),
            eq(knowledgeEdges.id, edgeId)
          )
        )
        .returning({ id: knowledgeEdges.id });
      return deleted !== undefined;
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
                visibleSourcePredicate(input.access, knowledgeNodeSources),
                inArray(
                  knowledgeNodeSources.nodeId,
                  rows.map((row) => row.node.id)
                )
              )
            )
        : [];
      const sources = sourcesByResourceId(sourceRows, (row) => row.nodeId);
      return rows.filter((row) => sources.has(row.node.id)).map((row) => ({
        node: knowledgeNodeFromRow(
          row.node,
          sources.get(row.node.id) ?? []
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
              visibleSourcePredicate(access, knowledgeNodeSources),
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
                  visibleSourcePredicate(access, knowledgeEdgeSources),
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
      if (!nodeSources.has(root.id)) {
        return { nodes: [], edges: [] };
      }
      const visibleNodeRows = nodeRows.filter((row) => nodeSources.has(row.id));
      const visibleNodeIds = new Set(visibleNodeRows.map((row) => row.id));
      return {
        nodes: visibleNodeRows.map((row) =>
          knowledgeNodeFromRow(
            row,
            nodeSources.get(row.id) ?? []
          )
        ),
        edges: edgeRows
          .filter((row) =>
            edgeSources.has(row.id) &&
            visibleNodeIds.has(row.sourceNodeId) &&
            visibleNodeIds.has(row.targetNodeId)
          )
          .map((row) =>
            edgeFromRow(
              row,
              edgeSources.get(row.id) ?? []
            )
          )
      };
    }
  };
}
