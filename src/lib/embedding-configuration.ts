import { defaultEmbeddingMinimumScore } from "@/domain/shared/semantic-search";

export function readEmbeddingDimensions(
  environment: Readonly<Record<string, string | undefined>> = process.env
): number | undefined {
  const raw = environment.EMBEDDING_DIM?.trim() ?? "native";
  if (raw.toLowerCase() === "native") {
    return undefined;
  }
  const dimensions = Number(raw);
  if (!Number.isSafeInteger(dimensions) || dimensions < 1) {
    throw new Error("EMBEDDING_DIM must be native or a positive integer");
  }
  return dimensions;
}

export function readEmbeddingMinimumScore(
  environment: Readonly<Record<string, string | undefined>> = process.env
): number {
  const raw = environment.EMBEDDING_MIN_SCORE?.trim();
  if (raw === undefined) {
    return defaultEmbeddingMinimumScore;
  }
  const score = Number(raw);
  if (!raw || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("EMBEDDING_MIN_SCORE must be between 0 and 1");
  }
  return score;
}
