import { count, eq, sql } from "drizzle-orm";

import type {
  KnowledgeOntologyTermUsage,
  KnowledgeTermUsageRepository
} from "@/domain/knowledge/knowledge-term-usage";

import type { AgentMemoryDatabase } from "../client";
import { knowledgeCandidates, knowledgeEdges, knowledgeNodes } from "../schema";

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
    .toSorted((left, right) => right.count - left.count)
    .slice(0, USAGE_LIMIT);
}

export function createKnowledgeTermUsageRepository(
  db: AgentMemoryDatabase
): KnowledgeTermUsageRepository {
  return {
    async collect(organizationId) {
      const [nodeKinds, edgePredicates, candidateTerms] = await Promise.all([
        db
          .select({ term: knowledgeNodes.kind, count: count() })
          .from(knowledgeNodes)
          .where(eq(knowledgeNodes.organizationId, organizationId))
          .groupBy(knowledgeNodes.kind),
        db
          .select({ term: knowledgeEdges.predicate, count: count() })
          .from(knowledgeEdges)
          .where(eq(knowledgeEdges.organizationId, organizationId))
          .groupBy(knowledgeEdges.predicate),
        db.execute<{ axis: string; term: string; count: number }>(sql`
          SELECT 'kind' AS axis, entity->>'kind' AS term, count(*)::int AS count
          FROM ${knowledgeCandidates},
               jsonb_array_elements(${knowledgeCandidates.graph}->'entities') AS entity
          WHERE ${knowledgeCandidates.organizationId} = ${organizationId}
            AND ${knowledgeCandidates.status} = 'pending'
          GROUP BY 2
          UNION ALL
          SELECT 'predicate' AS axis,
                 relationship->>'predicate' AS term,
                 count(*)::int AS count
          FROM ${knowledgeCandidates},
               jsonb_array_elements(${knowledgeCandidates.graph}->'relationships') AS relationship
          WHERE ${knowledgeCandidates.organizationId} = ${organizationId}
            AND ${knowledgeCandidates.status} = 'pending'
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
