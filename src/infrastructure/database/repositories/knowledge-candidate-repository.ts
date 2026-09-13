import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { ScopedResource } from "@/domain/identity/organization-access";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { entityReviewKey, relationshipReviewKey, reviewedCandidateState, selectKnowledgeCandidateItems } from "@/domain/knowledge/knowledge-candidate-selection";
import { AmbiguousKnowledgeIdentityError, knowledgeAliases, resolveKnowledgeIdentity } from "@/domain/knowledge/knowledge-alias";
import { mergeKnowledgeDescriptions } from "@/domain/knowledge/knowledge-description";
import type { KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { currentKnowledgeAssessmentPolicyVersion } from "@/domain/knowledge/knowledge-assessment";
import { knowledgeCanonicalNameKey, normalizeKnowledgeKind } from "@/domain/knowledge/knowledge-identity";
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
  createKnowledgeGraphRepository,
  edgeValues,
  visibleSourcePredicate
} from "./knowledge-graph-repository";
import {
  knowledgeScopeFromRow,
  knowledgeNodeFromRow,
  knowledgeSourceFromRow,
  upsertKnowledgeNode
} from "./knowledge-node-persistence";
import { scopedManagePredicate, scopedReadPredicate } from "./scope-predicates";
import { loadKnowledgeSourceScopes, lockKnowledgeScope } from "./knowledge-scope-lock";
import { createOrganizationAccessRepository } from "./organization-access-repository";
import { canAccessScopedResource } from "@/domain/identity/organization-access";

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
  candidateId: string,
  access: OrganizationAccess,
  now: Date
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
          scopedReadPredicate(access, knowledgeNodes),
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
          scopedReadPredicate(access, knowledgeEdges),
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
              visibleSourcePredicate(access, knowledgeNodeSources, now),
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
              visibleSourcePredicate(access, knowledgeEdgeSources, now),
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
  const visibleNodeIds = new Set(nodeRows.filter(({ node }) => nodeSources.has(node.id)).map(({ node }) => node.id));
  return {
    nodes: nodeRows.filter(({ node }) => visibleNodeIds.has(node.id)).map(({ node }) =>
      knowledgeNodeFromRow(node, nodeSources.get(node.id) ?? [])
    ),
    edges: edgeRows.filter(({ edge }) => edgeSources.has(edge.id) && visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId)).map(({ edge }) =>
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
    ...(row.assessmentHistory.length ? { assessmentHistory:row.assessmentHistory } : {}),
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

function candidateValues(candidate: KnowledgeCandidate) {
  return {
    id: candidate.id, organizationId: candidate.scope.organizationId, documentId: candidate.documentId,
    chunkId: candidate.chunkId, model: candidate.model,
    graph: candidate.graph, status: candidate.status, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt
  };
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

    async listUnextractedChunks(access) {
      const rows = await db.select({ id: documentChunks.id }).from(documents)
        .innerJoin(documentChunks, and(eq(documentChunks.organizationId, documents.organizationId), eq(documentChunks.documentId, documents.id)))
        .where(and(
          eq(documents.organizationId, access.organizationId), eq(documents.status, "ready"), scopedManagePredicate(access, documents),
          sql`NOT EXISTS (SELECT 1 FROM ${knowledgeCandidates} WHERE ${knowledgeCandidates.organizationId} = ${documentChunks.organizationId}
            AND ${knowledgeCandidates.chunkId} = ${documentChunks.id})`
        )).orderBy(asc(documents.createdAt), asc(documentChunks.ordinal), asc(documentChunks.id));
      return rows.map((row) => row.id);
    },

    async processingProgress(access) {
      const result = await db.execute<{ totalChunks: number; extractedChunks: number; curatedChunks: number }>(sql`
        SELECT count(*)::int AS "totalChunks", count(${knowledgeCandidates.id})::int AS "extractedChunks",
          count(*) FILTER (WHERE ${knowledgeCandidates.status} <> 'pending'
            OR (jsonb_array_length(${knowledgeCandidates.graph}->'entities') = 0
            OR (${knowledgeCandidates.assessment}->>'policyVersion' = ${currentKnowledgeAssessmentPolicyVersion} AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(${knowledgeCandidates.assessment}->'items') item
              WHERE item->>'verdict' <> 'review' AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(${knowledgeCandidates.itemReviews}) reviewed WHERE reviewed->>'item' = item->>'item'
              )
            ))))::int AS "curatedChunks"
        FROM ${documents} JOIN ${documentChunks} ON ${documentChunks.organizationId} = ${documents.organizationId} AND ${documentChunks.documentId} = ${documents.id}
        LEFT JOIN ${knowledgeCandidates} ON ${knowledgeCandidates.organizationId} = ${documents.organizationId} AND ${knowledgeCandidates.chunkId} = ${documentChunks.id}
        WHERE ${documents.organizationId} = ${access.organizationId} AND ${documents.status} = 'ready' AND ${scopedReadPredicate(access, documents)}
      `);
      return result.rows[0] ?? { totalChunks: 0, extractedChunks: 0, curatedChunks: 0 };
    },

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
      await db.update(knowledgeCandidates).set({ assessment,
        assessmentHistory:sql`CASE WHEN ${knowledgeCandidates.assessment} IS NULL THEN ${knowledgeCandidates.assessmentHistory}
          ELSE ${knowledgeCandidates.assessmentHistory} || jsonb_build_array(${knowledgeCandidates.assessment}) END` })
        .where(and(eq(knowledgeCandidates.organizationId, organizationId), eq(knowledgeCandidates.id, candidateId),
          eq(knowledgeCandidates.status, "pending"), sql`(${knowledgeCandidates.assessment} IS NULL
            OR ${knowledgeCandidates.assessment}->>'policyVersion' IS DISTINCT FROM ${assessment.policyVersion})`));
      return findById(organizationId, candidateId);
    },

    async deferIdentityResolution(organizationId, candidateId, entityKeys) {
      await db.transaction(async (transaction) => {
        const [row] = await transaction.select().from(knowledgeCandidates)
          .where(and(eq(knowledgeCandidates.organizationId, organizationId), eq(knowledgeCandidates.id, candidateId))).for("update");
        if (!row?.assessment || row.status !== "pending") return;
        const deferred = new Set(entityKeys.map(entityReviewKey));
        const reviewed = new Set(row.itemReviews.map((review) => review.item));
        row.graph.relationships.forEach((relationship, index) => {
          if (entityKeys.includes(relationship.sourceKey) || entityKeys.includes(relationship.targetKey)) deferred.add(relationshipReviewKey(index));
        });
        await transaction.update(knowledgeCandidates).set({ assessment: {
          ...row.assessment,
          items: row.assessment.items.map((item) => deferred.has(item.item) && !reviewed.has(item.item)
            ? { ...item, verdict: "review" as const, reason: "Several existing entities match this name. Resolve their identity before applying this knowledge." } : item)
        } }).where(eq(knowledgeCandidates.id, candidateId));
      });
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
        .values(candidateValues(candidate))
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
        // Resolve and merge names atomically with every other graph/scope mutation.
        await lockKnowledgeScope(transaction, input.organizationId, true);
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
        const reviewer = await createOrganizationAccessRepository(transaction).findByUser(input.organizationId, input.reviewedBy);
        if (!reviewer || !canAccessScopedResource(reviewer, "manage", candidate.scope)) return { status: "access_denied" } as const;
        // The idempotent already-accepted return must stay ahead of both the
        // source-readiness and promotion-completeness checks: callers replay
        // accepted candidates with empty promotion inputs.
        if (input.selection) { selectKnowledgeCandidateItems(candidate, input.selection); }
        if (candidate.status === "accepted") {
          const promoted = await promotedResourcesForCandidate(
            transaction,
            input.organizationId,
            candidate.id,
            reviewer,
            input.reviewedAt
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
        const nodeIds = new Map<string, string>();
        const descriptions = new Map<string, string>();
        const graphRepository = createKnowledgeGraphRepository(transaction, () => input.reviewedAt);
        // A stable order also makes alias bridges within one candidate deterministic.
        const orderedEntities = selected.graph.entities.toSorted((left, right) => {
          const a = `${normalizeKnowledgeKind(left.kind)}:${knowledgeCanonicalNameKey(left.canonicalName)}`;
          const b = `${normalizeKnowledgeKind(right.kind)}:${knowledgeCanonicalNameKey(right.canonicalName)}`;
          return a < b ? -1 : a > b ? 1 : 0;
        });
        for (const entity of orderedEntities) {
          const promotion = promotions.get(entity.key);
          if (!promotion) {
            throw new Error("knowledge candidate entity promotion is missing");
          }
          const verifiedAliases = candidate.assessment?.items.find((item) => item.item === entityReviewKey(entity.key))?.verdict === "accept"
            ? (candidate.assessment.aliases ?? []).filter((alias) => alias.entityKey === entity.key && alias.verdict === "accept").map((alias) => alias.alias) : [];
          // A relationship review must not change an already reviewed endpoint's alias decision.
          const priorReview = candidate.itemReviews?.find((review) => review.item === entityReviewKey(entity.key));
          const aliasReviewMethod = priorReview ? priorReview.method ?? "human" : input.method ?? "human";
          const aliases = aliasReviewMethod === "automatic" ? verifiedAliases : entity.aliases ?? [];
          let existing = await graphRepository.findNodesByNames(reviewer, candidate.scope, [entity.canonicalName, ...aliases]);
          const sources = await loadKnowledgeSourceScopes(transaction, input.organizationId, existing.flatMap((node) => node.sources), input.reviewedAt);
          if ([...sources.values()].some((source) => !source.available)) {
            existing = await graphRepository.findNodesByNames(reviewer, candidate.scope, [entity.canonicalName, ...aliases]);
          }
          const identity = resolveKnowledgeIdentity({ ...entity, aliases }, existing);
          if (identity.status === "ambiguous") throw new AmbiguousKnowledgeIdentityError([entity.key]);
          if (identity.status === "resolved") {
            for (const sourceNodeId of identity.mergeNodeIds) {
              const merged = await graphRepository.mergeNodes({ organizationId: input.organizationId, sourceNodeId,
                targetNodeId: identity.target.id, mergedBy: input.reviewedBy, now: input.reviewedAt,
                reason: `Verified aliases from knowledge candidate ${candidate.id} (${input.method ?? "human"}).` });
              if (!merged) throw new Error("verified knowledge identity merge failed");
              for (const [key, id] of nodeIds) if (id === sourceNodeId) nodeIds.set(key, identity.target.id);
              const combined = mergeKnowledgeDescriptions([descriptions.get(identity.target.id) ?? "", descriptions.get(sourceNodeId) ?? ""]);
              if (combined) descriptions.set(identity.target.id, combined);
              descriptions.delete(sourceNodeId);
            }
          }
          const canonicalName = identity.status === "resolved" ? identity.target.canonicalName : entity.canonicalName;
          const summary = mergeKnowledgeDescriptions([identity.status === "resolved" ? descriptions.get(identity.target.id) ?? "" : "",
            entity.summary ?? entity.evidence?.join(" ") ?? ""]);
          const proposedNode = createKnowledgeNode({
            id: promotion.id,
            scope: candidate.scope,
            kind: entity.kind,
            canonicalName,
            aliases: knowledgeAliases(canonicalName, [entity.canonicalName, ...aliases]),
            ...(summary ? { summary } : {}),
            ...(promotion.embedding ? { embedding: promotion.embedding } : {}),
            source: { chunkId: candidate.chunkId },
            now: input.reviewedAt
          });
          const node = await upsertKnowledgeNode(transaction, proposedNode);
          if (summary) descriptions.set(node.id, summary);
          await transaction
            .insert(knowledgeCandidateNodes)
            .values({
              organizationId: input.organizationId,
              candidateId: candidate.id,
              nodeId: node.id,
              createdAt: input.reviewedAt
            })
            .onConflictDoNothing();
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
        const visible = await promotedResourcesForCandidate(transaction, input.organizationId, candidate.id, reviewer, input.reviewedAt);
        const nodesById = new Map(visible.nodes.map((node) => [node.id, node]));
        const edgeIds = new Set(edges.map((edge) => edge.id));
        return {
          status: "promoted",
          candidate: candidateFromRow(reviewed, candidate.scope),
          nodes: selected.graph.entities.flatMap((entity) => {
            const node = nodesById.get(nodeIds.get(entity.key)!);
            return node ? [node] : [];
          }),
          edges: visible.edges.filter((edge) => edgeIds.has(edge.id))
        } as const;
      });
    },

    async reject(input) {
      return db.transaction(async (transaction) => {
        await lockKnowledgeScope(transaction, input.organizationId);
        const [locked] = await transaction.select({ candidate: knowledgeCandidates, document: documents })
          .from(knowledgeCandidates).innerJoin(documents, and(
            eq(documents.organizationId, knowledgeCandidates.organizationId),
            eq(documents.id, knowledgeCandidates.documentId)
          )).where(and(eq(knowledgeCandidates.organizationId, input.organizationId), eq(knowledgeCandidates.id, input.candidateId)))
          .for("update").limit(1);
        if (!locked) { return null; }
        const candidate = candidateFromRow(locked.candidate, knowledgeScopeFromRow(locked.document));
        const reviewer = await createOrganizationAccessRepository(transaction).findByUser(input.organizationId, input.reviewedBy);
        if (!reviewer || !canAccessScopedResource(reviewer, "manage", candidate.scope)) return null;
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
