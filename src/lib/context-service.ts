import { buildSearchContext, type ContextSearchDependencies } from "@/application/context/search-context";
import { logger } from "@/infrastructure/observability/logger";

import { searchDocumentRecords } from "./document-service";
import { searchKnowledgeNodeRecords } from "./knowledge-service";
import { searchMemoryRecords } from "./memory-service";
import {
  rerankerMinimumScore,
  textEmbeddingService,
  textRerankerService
} from "./container";

const contextSearchDependencies: ContextSearchDependencies = {
  searchMemories: searchMemoryRecords,
  searchDocuments: searchDocumentRecords,
  searchKnowledge: searchKnowledgeNodeRecords,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {}),
  ...(textRerankerService ? { rerankerService: textRerankerService } : {}),
  ...(rerankerMinimumScore !== undefined
    ? { minimumRerankScore: rerankerMinimumScore }
    : {}),
  onRerankerUnavailable(error) {
    logger.warn({ err: error }, "context reranking unavailable; using hybrid ranking");
  }
};

export const searchContextRecords = buildSearchContext(contextSearchDependencies);
export const recallMemoryRecords = buildSearchContext(contextSearchDependencies, ["memory"]);
