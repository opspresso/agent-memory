import { buildSearchContext } from "@/application/context/search-context";

import { searchDocumentRecords } from "./document-service";
import { searchKnowledgeNodeRecords } from "./knowledge-service";
import { searchMemoryRecords } from "./memory-service";
import { textEmbeddingService } from "./container";

export const searchContextRecords = buildSearchContext({
  searchMemories: searchMemoryRecords,
  searchDocuments: searchDocumentRecords,
  searchKnowledge: searchKnowledgeNodeRecords,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});
