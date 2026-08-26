import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

const lexicalWeight = 0.4;
const vectorWeight = 0.6;

interface HybridSearchInput {
  readonly search: SQLWrapper;
  readonly embedding: SQLWrapper;
  readonly embeddingModel: SQLWrapper;
  readonly query: string;
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

export function combinedHybridScore(
  lexicalScore: number,
  vectorScore: number
): number {
  return lexicalWeight * lexicalScore + vectorWeight * vectorScore;
}

export function hybridSearchExpressions(
  input: HybridSearchInput
): HybridSearchExpressions {
  const rawLexicalScore = sql<number>`ts_rank_cd(
    ${input.search},
    websearch_to_tsquery('simple', ${input.query})
  )`;
  const lexicalScore = sql<number>`${rawLexicalScore} / (1 + ${rawLexicalScore})`;
  const lexicalMatches = sql`${input.search} @@ websearch_to_tsquery('simple', ${input.query})`;
  if (!input.queryEmbedding) {
    return {
      lexicalScore,
      vectorScore: sql<number>`0::double precision`,
      score: lexicalScore,
      matches: lexicalMatches
    };
  }

  const vectorLiteral = `[${input.queryEmbedding.values.join(",")}]`;
  const vectorScore = sql<number>`CASE
    WHEN ${input.embedding} IS NOT NULL
      AND ${input.embeddingModel} = ${input.queryEmbedding.model}
    THEN GREATEST(0, LEAST(1, 1 - ((${input.embedding} <=> ${vectorLiteral}::vector) / 2)))
    ELSE 0
  END`;
  return {
    lexicalScore,
    vectorScore,
    score: sql<number>`(${lexicalWeight} * ${lexicalScore}) + (${vectorWeight} * ${vectorScore})`,
    matches: sql`(${lexicalMatches}) OR (
      ${input.embedding} IS NOT NULL
      AND ${input.embeddingModel} = ${input.queryEmbedding.model}
    )`
  };
}
