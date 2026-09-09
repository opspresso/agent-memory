import { readAiRequestLimits } from "@/infrastructure/ai/request-limiter";

export function readKnowledgeEnrichmentConcurrency(
  environment: Readonly<Record<string, string | undefined>> = process.env
): number {
  const value = Number(environment.KNOWLEDGE_ENRICHMENT_CONCURRENCY ?? 4);
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw new Error("KNOWLEDGE_ENRICHMENT_CONCURRENCY must be an integer between 1 and 16");
  }
  return Math.min(value, readAiRequestLimits(environment).maxConcurrent);
}
