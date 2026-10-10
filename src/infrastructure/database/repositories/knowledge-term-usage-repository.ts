import { and, count, eq, sql } from "drizzle-orm";

import type {
  KnowledgeOntologyTermUsage,
  KnowledgeTermUsageRepository
} from "@/domain/knowledge/knowledge-term-usage";

import type { AgentMemoryDatabase } from "../client";
import { documents, knowledgeCandidates, knowledgeEdges, knowledgeNodes } from "../schema";
import { scopedReadPredicate } from "./scope-predicates";
import { edgeHasVisibleSource, nodeHasVisibleSource } from "./knowledge-graph-repository";

const USAGE_LIMIT = 50;

function mergedUsage(
  sources: readonly (readonly { term: string; count: number }[])[]
): readonly KnowledgeOntologyTermUsage[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    for (const entry of source) {
      counts.set(entry.term, (counts.get(entry.term) ?? 0) + entry.count);
    }
  }
  return [...counts.entries()]
    .map(([term, total]) => ({ term, count: total }))
    .toSorted((left, right) => right.count - left.count || (left.term < right.term ? -1 : left.term > right.term ? 1 : 0))
    .slice(0, USAGE_LIMIT);
}

export function createKnowledgeTermUsageRepository(
  db: AgentMemoryDatabase
): KnowledgeTermUsageRepository {
  return {
    async collect(access) {
      const now = new Date();
      const organizationId = access.organizationId;
      const [nodeKinds, edgePredicates, candidateTerms] = await Promise.all([
        db
          .select({ term: knowledgeNodes.kind, count: count() })
          .from(knowledgeNodes)
          .where(and(eq(knowledgeNodes.organizationId, organizationId),
            scopedReadPredicate(access, knowledgeNodes), nodeHasVisibleSource(access, now)))
          .groupBy(knowledgeNodes.kind),
        db
          .select({ term: knowledgeEdges.predicate, count: count() })
          .from(knowledgeEdges)
          .where(and(eq(knowledgeEdges.organizationId, organizationId),
            scopedReadPredicate(access, knowledgeEdges), edgeHasVisibleSource(access, now),
            sql`2 = (SELECT count(*) FROM ${knowledgeNodes}
              WHERE ${knowledgeNodes.organizationId} = ${knowledgeEdges.organizationId}
                AND ${knowledgeNodes.id} IN (${knowledgeEdges.sourceNodeId}, ${knowledgeEdges.targetNodeId})
                AND ${scopedReadPredicate(access, knowledgeNodes)} AND ${nodeHasVisibleSource(access, now)})`))
          .groupBy(knowledgeEdges.predicate),
        db.execute<{ axis: string; term: string; count: number }>(sql`
          SELECT 'kind' AS axis, entity->>'kind' AS term, count(*)::int AS count
          FROM ${knowledgeCandidates} JOIN ${documents}
            ON ${documents.organizationId} = ${knowledgeCandidates.organizationId}
              AND ${documents.id} = ${knowledgeCandidates.documentId}
          CROSS JOIN LATERAL jsonb_array_elements(${knowledgeCandidates.graph}->'entities') AS entity
          WHERE ${knowledgeCandidates.organizationId} = ${organizationId}
            AND ${knowledgeCandidates.status} = 'pending'
            AND ${documents.status} = 'ready' AND ${scopedReadPredicate(access, documents)}
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(${knowledgeCandidates.itemReviews}) AS review
              WHERE review->>'item' = 'entity:' || (entity->>'key')
            )
          GROUP BY 2
          UNION ALL
          SELECT 'predicate' AS axis,
                 relationship->>'predicate' AS term,
                 count(*)::int AS count
          FROM ${knowledgeCandidates} JOIN ${documents}
            ON ${documents.organizationId} = ${knowledgeCandidates.organizationId}
              AND ${documents.id} = ${knowledgeCandidates.documentId}
          CROSS JOIN LATERAL jsonb_array_elements(${knowledgeCandidates.graph}->'relationships')
            WITH ORDINALITY AS proposed(relationship, ordinal)
          WHERE ${knowledgeCandidates.organizationId} = ${organizationId}
            AND ${knowledgeCandidates.status} = 'pending'
            AND ${documents.status} = 'ready' AND ${scopedReadPredicate(access, documents)}
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(${knowledgeCandidates.itemReviews}) AS review
              WHERE review->>'item' = 'relationship:' || (ordinal - 1)::text
            )
          GROUP BY 2
        `)
      ]);
      const candidateKinds = candidateTerms.rows.filter(
        (row) => row.axis === "kind"
      );
      const candidatePredicates = candidateTerms.rows.filter(
        (row) => row.axis === "predicate"
      );
      return {
        nodeKinds: mergedUsage([nodeKinds, candidateKinds]),
        edgePredicates: mergedUsage([edgePredicates, candidatePredicates])
      };
    }
  };
}
