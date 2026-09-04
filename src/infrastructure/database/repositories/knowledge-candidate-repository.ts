import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { ScopedResource } from "@/domain/identity/organization-access";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import {
  createKnowledgeEdge,
  createKnowledgeNode
} from "@/domain/knowledge/knowledge-graph";

import type { AgentMemoryDatabase } from "../client";
import {
  documents,
  knowledgeCandidates,
  knowledgeEdges,
  knowledgeEdgeSources,
  knowledgeNodes,
  knowledgeNodeSources
} from "../schema";
import {
  edgeFromRow,
  edgeValues
} from "./knowledge-graph-repository";
import {
  knowledgeScopeFromRow,
  knowledgeNodeFromRow,
  knowledgeSourceFromRow,
  upsertKnowledgeNode
} from "./knowledge-node-persistence";
import { scopedManagePredicate } from "./scope-predicates";

type CandidateRow = typeof knowledgeCandidates.$inferSelect;
type AgentMemoryTransaction = Parameters<
  Parameters<AgentMemoryDatabase["transaction"]>[0]
>[0];

function sourcesByResourceId<
  T extends { readonly memoryId: string | null; readonly chunkId: string | null }
>(rows: readonly T[], resourceIdFor: (row: T) => string) {
  const result = new Map<string, ReturnType<typeof knowledgeSourceFromRow>[]>();
  for (const row of rows) {
    const resourceId = resourceIdFor(row);
    const sources = result.get(resourceId) ?? [];
    sources.push(knowledgeSourceFromRow(row));
    result.set(resourceId, sources);
  }
  return result;
}

async function promotedResourcesForChunk(
  transaction: AgentMemoryTransaction,
  organizationId: string,
  chunkId: string
) {
  const [nodeRows, edgeRows] = await Promise.all([
    transaction
      .select({ node: knowledgeNodes })
      .from(knowledgeNodeSources)
      .innerJoin(
        knowledgeNodes,
        and(
          eq(knowledgeNodes.organizationId, knowledgeNodeSources.organizationId),
          eq(knowledgeNodes.id, knowledgeNodeSources.nodeId)
        )
      )
      .where(
        and(
          eq(knowledgeNodeSources.organizationId, organizationId),
          eq(knowledgeNodeSources.chunkId, chunkId)
        )
      )
      .orderBy(asc(knowledgeNodes.id)),
    transaction
      .select({ edge: knowledgeEdges })
      .from(knowledgeEdgeSources)
      .innerJoin(
        knowledgeEdges,
        and(
          eq(knowledgeEdges.organizationId, knowledgeEdgeSources.organizationId),
          eq(knowledgeEdges.id, knowledgeEdgeSources.edgeId)
        )
      )
      .where(
        and(
          eq(knowledgeEdgeSources.organizationId, organizationId),
          eq(knowledgeEdgeSources.chunkId, chunkId)
        )
      )
      .orderBy(asc(knowledgeEdges.id))
  ]);
  const [nodeSourceRows, edgeSourceRows] = await Promise.all([
    nodeRows.length > 0
      ? transaction
          .select()
          .from(knowledgeNodeSources)
          .where(
            and(
              eq(knowledgeNodeSources.organizationId, organizationId),
              inArray(
                knowledgeNodeSources.nodeId,
                nodeRows.map(({ node }) => node.id)
              )
            )
          )
      : Promise.resolve([]),
    edgeRows.length > 0
      ? transaction
          .select()
          .from(knowledgeEdgeSources)
          .where(
            and(
              eq(knowledgeEdgeSources.organizationId, organizationId),
              inArray(
                knowledgeEdgeSources.edgeId,
                edgeRows.map(({ edge }) => edge.id)
              )
            )
          )
      : Promise.resolve([])
  ]);
  const nodeSources = sourcesByResourceId(nodeSourceRows, (row) => row.nodeId);
  const edgeSources = sourcesByResourceId(edgeSourceRows, (row) => row.edgeId);
  return {
    nodes: nodeRows.map(({ node }) =>
      knowledgeNodeFromRow(node, nodeSources.get(node.id) ?? [])
    ),
    edges: edgeRows.map(({ edge }) =>
      edgeFromRow(edge, edgeSources.get(edge.id) ?? [])
    )
  };
}

function candidateFromRow(
  row: CandidateRow,
  scope: ScopedResource
): KnowledgeCandidate {
  return {
    id: row.id,
    scope,
    documentId: row.documentId,
    chunkId: row.chunkId,
    model: row.model,
    graph: row.graph,
    status: row.status,
    ...(row.reviewedBy ? { reviewedBy: row.reviewedBy } : {}),
    ...(row.reviewReason ? { reviewReason: row.reviewReason } : {}),
    ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function candidateReviewPredicate(access: OrganizationAccess): SQL {
  return scopedManagePredicate(access, documents);
}

export function createKnowledgeCandidateRepository(
  db: AgentMemoryDatabase
): KnowledgeCandidateRepository {
  async function findById(organizationId: string, candidateId: string) {
    const [row] = await db
      .select({ candidate: knowledgeCandidates, document: documents })
      .from(knowledgeCandidates)
      .innerJoin(
        documents,
        and(
          eq(documents.organizationId, knowledgeCandidates.organizationId),
          eq(documents.id, knowledgeCandidates.documentId)
        )
      )
      .where(
        and(
          eq(knowledgeCandidates.organizationId, organizationId),
          eq(knowledgeCandidates.id, candidateId)
        )
      )
      .limit(1);
    return row
      ? candidateFromRow(row.candidate, knowledgeScopeFromRow(row.document))
      : null;
  }

  return {
    findById,

    async findByChunkId(organizationId, chunkId) {
      const [row] = await db
        .select({ candidate: knowledgeCandidates, document: documents })
        .from(knowledgeCandidates)
        .innerJoin(
          documents,
          and(
            eq(documents.organizationId, knowledgeCandidates.organizationId),
            eq(documents.id, knowledgeCandidates.documentId)
          )
        )
        .where(
          and(
            eq(knowledgeCandidates.organizationId, organizationId),
            eq(knowledgeCandidates.chunkId, chunkId)
          )
        )
        .limit(1);
      return row
        ? candidateFromRow(row.candidate, knowledgeScopeFromRow(row.document))
        : null;
    },

    async save(candidate) {
      const [row] = await db
        .insert(knowledgeCandidates)
        .values({
          id: candidate.id,
          organizationId: candidate.scope.organizationId,
          documentId: candidate.documentId,
          chunkId: candidate.chunkId,
          model: candidate.model,
          graph: candidate.graph,
          status: candidate.status,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt
        })
        .onConflictDoNothing({
          target: [
            knowledgeCandidates.organizationId,
            knowledgeCandidates.chunkId
          ]
        })
        .returning();
      if (row) {
        return candidateFromRow(row, candidate.scope);
      }
      const existing = await this.findByChunkId(
        candidate.scope.organizationId,
        candidate.chunkId
      );
      if (!existing) {
        throw new Error("knowledge candidate upsert returned no row");
      }
      return existing;
    },

    async listPending(access, limit) {
      const rows = await db
        .select({ candidate: knowledgeCandidates, document: documents })
        .from(knowledgeCandidates)
        .innerJoin(
          documents,
          and(
            eq(documents.organizationId, knowledgeCandidates.organizationId),
            eq(documents.id, knowledgeCandidates.documentId)
          )
        )
        .where(
          and(
            eq(
              knowledgeCandidates.organizationId,
              access.organizationId
            ),
            eq(knowledgeCandidates.status, "pending"),
            eq(documents.status, "ready"),
            candidateReviewPredicate(access)
          )
        )
        .orderBy(asc(knowledgeCandidates.createdAt))
        .limit(limit);
      return rows.map((row) =>
        candidateFromRow(row.candidate, knowledgeScopeFromRow(row.document))
      );
    },

    async accept(input) {
      return db.transaction(async (transaction) => {
        const [locked] = await transaction
          .select({ candidate: knowledgeCandidates, document: documents })
          .from(knowledgeCandidates)
          .innerJoin(
            documents,
            and(
              eq(documents.organizationId, knowledgeCandidates.organizationId),
              eq(documents.id, knowledgeCandidates.documentId)
            )
          )
          .where(
            and(
              eq(knowledgeCandidates.organizationId, input.organizationId),
              eq(knowledgeCandidates.id, input.candidateId)
            )
          )
          .for("update")
          .limit(1);
        if (!locked) {
          return { status: "not_found" } as const;
        }
        const candidate = candidateFromRow(
          locked.candidate,
          knowledgeScopeFromRow(locked.document)
        );
        // The idempotent already-accepted return must stay ahead of both the
        // source-readiness and promotion-completeness checks: callers replay
        // accepted candidates with empty promotion inputs.
        if (candidate.status === "accepted") {
          const promoted = await promotedResourcesForChunk(
            transaction,
            input.organizationId,
            candidate.chunkId
          );
          return { status: "promoted", candidate, ...promoted } as const;
        }
        if (candidate.status !== "pending") {
          return { status: "already_rejected" } as const;
        }
        if (locked.document.status !== "ready") {
          return { status: "source_not_ready" } as const;
        }
        const promotions = new Map(
          input.entityPromotions.map((promotion) => [promotion.key, promotion])
        );
        if (
          promotions.size !== candidate.graph.entities.length ||
          input.relationshipIds.length !== candidate.graph.relationships.length
        ) {
          throw new Error("knowledge candidate promotion IDs are incomplete");
        }
        const nodes = [];
        const nodeIds = new Map<string, string>();
        for (const entity of candidate.graph.entities) {
          const promotion = promotions.get(entity.key);
          if (!promotion) {
            throw new Error("knowledge candidate entity promotion is missing");
          }
          const proposedNode = createKnowledgeNode({
            id: promotion.id,
            scope: candidate.scope,
            kind: entity.kind,
            canonicalName: entity.canonicalName,
            ...(entity.summary ? { summary: entity.summary } : {}),
            ...(promotion.embedding ? { embedding: promotion.embedding } : {}),
            source: { chunkId: candidate.chunkId },
            now: input.reviewedAt
          });
          const node = await upsertKnowledgeNode(transaction, proposedNode);
          nodes.push(node);
          nodeIds.set(entity.key, node.id);
        }
        const edges = [];
        for (const [index, relationship] of
          candidate.graph.relationships.entries()) {
          const sourceNodeId = nodeIds.get(relationship.sourceKey);
          const targetNodeId = nodeIds.get(relationship.targetKey);
          const edgeId = input.relationshipIds[index];
          if (!sourceNodeId || !targetNodeId || !edgeId) {
            throw new Error("promoted knowledge relationship is incomplete");
          }
          if (sourceNodeId === targetNodeId) {
            continue;
          }
          const proposedEdge = createKnowledgeEdge({
            id: edgeId,
            organizationId: input.organizationId,
            scope: candidate.scope,
            sourceNodeId,
            targetNodeId,
            predicate: relationship.predicate,
            source: { chunkId: candidate.chunkId },
            now: input.reviewedAt
          });
          const [row] = await transaction
            .insert(knowledgeEdges)
            .values(edgeValues(proposedEdge))
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
              set: { properties: sql`${knowledgeEdges.properties}` }
            })
            .returning();
          if (!row) {
            throw new Error("promoted knowledge edge upsert returned no row");
          }
          await transaction
            .insert(knowledgeEdgeSources)
            .values({
              organizationId: input.organizationId,
              edgeId: row.id,
              chunkId: candidate.chunkId,
              createdAt: input.reviewedAt
            })
            .onConflictDoNothing();
          const sourceRows = await transaction
            .select()
            .from(knowledgeEdgeSources)
            .where(
              and(
                eq(knowledgeEdgeSources.organizationId, input.organizationId),
                eq(knowledgeEdgeSources.edgeId, row.id)
              )
            );
          edges.push(
            edgeFromRow(
              row,
              sourceRows.map((source) =>
                source.memoryId
                  ? { memoryId: source.memoryId }
                  : { chunkId: source.chunkId! }
              )
            )
          );
        }
        const [reviewed] = await transaction
          .update(knowledgeCandidates)
          .set({
            status: "accepted",
            reviewedBy: input.reviewedBy,
            reviewReason: input.reason ?? null,
            reviewedAt: input.reviewedAt,
            updatedAt: input.reviewedAt
          })
          .where(
            and(
              eq(knowledgeCandidates.organizationId, input.organizationId),
              eq(knowledgeCandidates.id, input.candidateId),
              eq(knowledgeCandidates.status, "pending")
            )
          )
          .returning();
        if (!reviewed) {
          throw new Error("knowledge candidate review claim was lost");
        }
        return {
          status: "promoted",
          candidate: candidateFromRow(reviewed, candidate.scope),
          nodes,
          edges
        } as const;
      });
    },

    async reject(input) {
      const [row] = await db
        .update(knowledgeCandidates)
        .set({
          status: "rejected",
          reviewedBy: input.reviewedBy,
          reviewReason: input.reason ?? null,
          reviewedAt: input.reviewedAt,
          updatedAt: input.reviewedAt
        })
        .where(
          and(
            eq(knowledgeCandidates.organizationId, input.organizationId),
            eq(knowledgeCandidates.id, input.candidateId),
            eq(knowledgeCandidates.status, "pending")
          )
        )
        .returning();
      if (row) {
        const candidate = await findById(input.organizationId, input.candidateId);
        return candidate;
      }
      const existing = await findById(input.organizationId, input.candidateId);
      return existing?.status === "rejected" ? existing : null;
    }
  };
}
