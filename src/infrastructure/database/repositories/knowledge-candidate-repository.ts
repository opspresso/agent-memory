import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { ScopedResource } from "@/domain/identity/organization-access";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { reviewedCandidateState, selectKnowledgeCandidateItems } from "@/domain/knowledge/knowledge-candidate-selection";
import type { KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import {
  createKnowledgeEdge,
  createKnowledgeNode
} from "@/domain/knowledge/knowledge-graph";

import type { AgentMemoryDatabase } from "../client";
import {
  documentChunks,
  documents,
  knowledgeCandidateEdges,
  knowledgeCandidateNodes,
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

async function promotedResourcesForCandidate(
  transaction: AgentMemoryTransaction,
  organizationId: string,
  candidateId: string
) {
  const [nodeRows, edgeRows] = await Promise.all([
    transaction
      .select({ node: knowledgeNodes })
      .from(knowledgeCandidateNodes)
      .innerJoin(
        knowledgeNodes,
        and(
          eq(knowledgeNodes.organizationId, knowledgeCandidateNodes.organizationId),
          eq(knowledgeNodes.id, knowledgeCandidateNodes.nodeId)
        )
      )
      .where(
        and(
          eq(knowledgeCandidateNodes.organizationId, organizationId),
          eq(knowledgeCandidateNodes.candidateId, candidateId)
        )
      )
      .orderBy(asc(knowledgeNodes.id)),
    transaction
      .select({ edge: knowledgeEdges })
      .from(knowledgeCandidateEdges)
      .innerJoin(
        knowledgeEdges,
        and(
          eq(knowledgeEdges.organizationId, knowledgeCandidateEdges.organizationId),
          eq(knowledgeEdges.id, knowledgeCandidateEdges.edgeId)
        )
      )
      .where(
        and(
          eq(knowledgeCandidateEdges.organizationId, organizationId),
          eq(knowledgeCandidateEdges.candidateId, candidateId)
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
    itemReviews: row.itemReviews,
    ...(row.assessment ? { assessment: row.assessment } : {}),
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

  async function findByChunkId(organizationId: string, chunkId: string) {
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
  }

  return {
    findById,
    findByChunkId,

    async reviewSummary(access) {
      const result = await db.execute<{ automaticAccepted: number; automaticIgnored: number }>(sql`
        SELECT count(*) FILTER (WHERE review->>'decision' = 'accepted')::int AS "automaticAccepted",
               count(*) FILTER (WHERE review->>'decision' = 'rejected')::int AS "automaticIgnored"
        FROM ${knowledgeCandidates} JOIN ${documents}
          ON ${documents.organizationId} = ${knowledgeCandidates.organizationId} AND ${documents.id} = ${knowledgeCandidates.documentId}
        CROSS JOIN LATERAL jsonb_array_elements(${knowledgeCandidates.itemReviews}) AS review
        WHERE ${knowledgeCandidates.organizationId} = ${access.organizationId}
          AND ${documents.status} = 'ready' AND ${candidateReviewPredicate(access)} AND review->>'method' = 'automatic'
      `);
      return result.rows[0] ?? { automaticAccepted: 0, automaticIgnored: 0 };
    },

    async saveAssessment(organizationId, candidateId, assessment) {
      await db.update(knowledgeCandidates).set({ assessment })
        .where(and(eq(knowledgeCandidates.organizationId, organizationId), eq(knowledgeCandidates.id, candidateId),
          eq(knowledgeCandidates.status, "pending"), sql`${knowledgeCandidates.assessment} IS NULL`));
      return findById(organizationId, candidateId);
    },

    async listReviewSources(access, assessmentHistory = false) {
      const query = db.select({ candidate: knowledgeCandidates, document: documents, ordinal: documentChunks.ordinal })
        .from(knowledgeCandidates).innerJoin(documents, and(
          eq(documents.organizationId, knowledgeCandidates.organizationId),
          eq(documents.id, knowledgeCandidates.documentId)
        )).innerJoin(documentChunks, and(
          eq(documentChunks.organizationId, knowledgeCandidates.organizationId),
          eq(documentChunks.id, knowledgeCandidates.chunkId)
        )).where(and(
          eq(knowledgeCandidates.organizationId, access.organizationId),
          assessmentHistory ? sql`${knowledgeCandidates.assessment} IS NOT NULL` : eq(knowledgeCandidates.status, "pending"), eq(documents.status, "ready"),
          sql`jsonb_array_length(${knowledgeCandidates.graph}->'entities') > 0`,
          candidateReviewPredicate(access)
        )).orderBy(assessmentHistory ? desc(knowledgeCandidates.updatedAt) : asc(knowledgeCandidates.createdAt), asc(knowledgeCandidates.id));
      const rows = assessmentHistory ? await query.limit(50) : await query;
      return rows.map((row) => ({
        candidate: candidateFromRow(row.candidate, knowledgeScopeFromRow(row.document)),
        documentTitle: row.document.title, ordinal: row.ordinal
      }));
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
      const existing = await findByChunkId(
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
            sql`jsonb_array_length(${knowledgeCandidates.graph}->'entities') > 0`,
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
        if (input.selection) { selectKnowledgeCandidateItems(candidate, input.selection); }
        if (candidate.status === "accepted") {
          const promoted = await promotedResourcesForCandidate(
            transaction,
            input.organizationId,
            candidate.id
          );
          return { status: "promoted", candidate, ...promoted } as const;
        }
        if (candidate.status !== "pending") {
          return { status: "already_rejected" } as const;
        }
        if (locked.document.status !== "ready") {
          return { status: "source_not_ready" } as const;
        }
        const selected = selectKnowledgeCandidateItems(candidate, input.selection);
        const promotions = new Map(
          input.entityPromotions.map((promotion) => [promotion.key, promotion])
        );
        if (
          selected.graph.entities.some((entity) => !promotions.has(entity.key)) ||
          input.relationshipIds.length !== candidate.graph.relationships.length
        ) {
          throw new Error("knowledge candidate promotion IDs are incomplete");
        }
        const nodes = [];
        const nodeIds = new Map<string, string>();
        for (const entity of selected.graph.entities) {
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
          await transaction
            .insert(knowledgeCandidateNodes)
            .values({
              organizationId: input.organizationId,
              candidateId: candidate.id,
              nodeId: node.id,
              createdAt: input.reviewedAt
            })
            .onConflictDoNothing();
          nodes.push(node);
          nodeIds.set(entity.key, node.id);
        }
        const edges = [];
        for (const [index, relationship] of
          candidate.graph.relationships.entries()) {
          if (!selected.relationshipIndexes.includes(index)) { continue; }
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
          await transaction
            .insert(knowledgeCandidateEdges)
            .values({
              organizationId: input.organizationId,
              candidateId: candidate.id,
              edgeId: row.id,
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
        const state = reviewedCandidateState(candidate, selected.items.map((item) => ({
          item, decision: "accepted", method: input.method ?? "human", reviewedBy: input.reviewedBy, reviewedAt: input.reviewedAt.toISOString(),
          ...(input.reason ? { reason: input.reason } : {})
        })));
        const [reviewed] = await transaction
          .update(knowledgeCandidates)
          .set({
            status: state.status,
            itemReviews: state.itemReviews,
            reviewedBy: state.status === "pending" ? null : input.reviewedBy,
            reviewReason: state.status === "pending" ? null : input.reason ?? null,
            reviewedAt: state.status === "pending" ? null : input.reviewedAt,
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
      return db.transaction(async (transaction) => {
        const [locked] = await transaction.select({ candidate: knowledgeCandidates, document: documents })
          .from(knowledgeCandidates).innerJoin(documents, and(
            eq(documents.organizationId, knowledgeCandidates.organizationId),
            eq(documents.id, knowledgeCandidates.documentId)
          )).where(and(eq(knowledgeCandidates.organizationId, input.organizationId), eq(knowledgeCandidates.id, input.candidateId)))
          .for("update").limit(1);
        if (!locked) { return null; }
        const candidate = candidateFromRow(locked.candidate, knowledgeScopeFromRow(locked.document));
        const selected = selectKnowledgeCandidateItems(candidate, input.selection, "rejected");
        if (candidate.status === "rejected") { return candidate; }
        if (candidate.status !== "pending") { return input.selection && selected.items.length === 0 ? candidate : null; }
        const state = reviewedCandidateState(candidate, selected.items.map((item) => ({
          item, decision: "rejected", method: input.method ?? "human", reviewedBy: input.reviewedBy, reviewedAt: input.reviewedAt.toISOString(),
          ...(input.reason ? { reason: input.reason } : {})
        })));
        const [row] = await transaction.update(knowledgeCandidates).set({
          status: state.status,
          itemReviews: state.itemReviews,
          reviewedBy: state.status === "pending" ? null : input.reviewedBy,
          reviewReason: state.status === "pending" ? null : input.reason ?? null,
          reviewedAt: state.status === "pending" ? null : input.reviewedAt,
          updatedAt: input.reviewedAt
        }).where(and(eq(knowledgeCandidates.organizationId, input.organizationId), eq(knowledgeCandidates.id, input.candidateId))).returning();
        return row ? candidateFromRow(row, candidate.scope) : null;
      });
    }
  };
}
