import type { KnowledgeExtractionLanguage } from "@/domain/knowledge/knowledge-extraction-service";

export function readKnowledgeExtractionLanguage(environment: Readonly<Record<string, string | undefined>> = process.env): KnowledgeExtractionLanguage {
  const language = environment.KNOWLEDGE_EXTRACTION_LANGUAGE ?? "ko";
  if (language !== "source" && language !== "ko" && language !== "en") {
    throw new Error("KNOWLEDGE_EXTRACTION_LANGUAGE must be source, ko, or en");
  }
  return language;
}
