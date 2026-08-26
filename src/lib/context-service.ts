import { buildSearchContext } from "@/application/context/search-context";

import { searchDocumentRecords } from "./document-service";
import { searchKnowledgeNodeRecords } from "./knowledge-service";
import { searchMemoryRecords } from "./memory-service";

export const searchContextRecords = buildSearchContext({
  searchMemories: searchMemoryRecords,
  searchDocuments: searchDocumentRecords,
  searchKnowledge: searchKnowledgeNodeRecords
});
