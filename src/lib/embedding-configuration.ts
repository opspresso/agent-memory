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
