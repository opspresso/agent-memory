import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { defaultEmbeddingMinimumScore } from "@/domain/shared/semantic-search";

const lexicalWeight = 0.4;
const vectorWeight = 0.6;

interface HybridSearchInput {
  readonly search: SQLWrapper;
  readonly embedding: SQLWrapper;
  readonly embeddingModel: SQLWrapper;
  readonly query: string;
  readonly minimumVectorScore?: number;
  readonly queryEmbedding?: Readonly<{
    model: string;
    values: readonly number[];
  }>;
}

export interface HybridSearchExpressions {
  readonly lexicalScore: SQL<number>;
  readonly vectorScore: SQL<number>;
  readonly score: SQL<number>;
  readonly matches: SQL;
}

export interface VectorSearchExpressions {
  readonly compatible: SQL;
  readonly score: SQL<number>;
  readonly matches: SQL;
}

export function combinedHybridScore(
  lexicalScore: number,
  vectorScore: number
): number {
  return lexicalWeight * lexicalScore + vectorWeight * vectorScore;
}

export function hybridSearchExpressions(
  input: HybridSearchInput
): HybridSearchExpressions {
  return combineHybridSearchExpressions(input, input.queryEmbedding
    ? vectorSearchExpressions({ ...input, queryEmbedding: input.queryEmbedding })
    : undefined);
}

export function combineHybridSearchExpressions(
  input: Pick<HybridSearchInput, "search" | "query">,
  vector?: Pick<VectorSearchExpressions, "score" | "matches">
): HybridSearchExpressions {
  const rawLexicalScore = sql<number>`ts_rank_cd(
    ${input.search},
    websearch_to_tsquery('simple', ${input.query})
  )`;
  const lexicalScore = sql<number>`${rawLexicalScore} / (1 + ${rawLexicalScore})`;
  const lexicalMatches = sql`${input.search} @@ websearch_to_tsquery('simple', ${input.query})`;
  if (!vector) {
    return {
      lexicalScore,
      vectorScore: sql<number>`0::double precision`,
      score: lexicalScore,
      matches: lexicalMatches
    };
  }

  return {
    lexicalScore,
    vectorScore: vector.score,
    score: sql<number>`(${lexicalWeight} * ${lexicalScore}) + (${vectorWeight} * ${vector.score})`,
    matches: sql`(${lexicalMatches}) OR (${vector.matches})`
  };
}

export function vectorSearchExpressions(
  input: Pick<HybridSearchInput, "embedding" | "embeddingModel" | "minimumVectorScore"> & {
    readonly queryEmbedding: NonNullable<HybridSearchInput["queryEmbedding"]>;
  }
): VectorSearchExpressions {
  const vectorLiteral = `[${input.queryEmbedding.values.join(",")}]`;
  const compatibleEmbedding = sql`${input.embedding} IS NOT NULL
    AND ${input.embeddingModel} = ${input.queryEmbedding.model}
    AND vector_dims(${input.embedding}) = ${input.queryEmbedding.values.length}
    AND vector_norm(${input.embedding}) > 0
    AND vector_norm(${vectorLiteral}::vector) > 0`;
  const vectorScore = sql<number>`CASE
    WHEN ${compatibleEmbedding}
    THEN GREATEST(0, LEAST(1, 1 - (${input.embedding} <=> ${vectorLiteral}::vector)))
    ELSE 0
  END`;
  return {
    compatible: compatibleEmbedding,
    score: vectorScore,
    matches: sql`${compatibleEmbedding}
      AND ${vectorScore} >= ${input.minimumVectorScore ?? defaultEmbeddingMinimumScore}`
  };
}
