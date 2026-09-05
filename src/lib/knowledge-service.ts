import { randomUUID } from "node:crypto";

import { buildAuthorizeKnowledgeSource } from "@/application/knowledge/authorize-knowledge-source";
import { buildCreateKnowledgeEdge } from "@/application/knowledge/create-knowledge-edge";
import { buildCreateKnowledgeNode } from "@/application/knowledge/create-knowledge-node";
import { buildGetKnowledgeNeighborhood } from "@/application/knowledge/get-knowledge-neighborhood";
import { buildMergeKnowledgeNodes } from "@/application/knowledge/merge-knowledge-nodes";
import {
  buildDeleteKnowledgeEdge,
  buildDeleteKnowledgeNode
} from "@/application/knowledge/delete-knowledge-resource";
import { buildSearchKnowledgeNodes } from "@/application/knowledge/search-knowledge-nodes";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import { observeRetrieval } from "@/infrastructure/observability/telemetry";

import {
  documentRepository,
  knowledgeGraphRepository,
  knowledgeOntologyReader,
  memoryRepository,
  textEmbeddingService
} from "./container";

const clock = () => new Date();
const authorizeSource = buildAuthorizeKnowledgeSource({
  clock,
  documentRepository,
  memoryRepository
});

export const createKnowledgeNodeRecord = buildCreateKnowledgeNode({
  authorizeSource,
  clock,
  generateId: randomUUID,
  ontologyReader: knowledgeOntologyReader,
  repository: knowledgeGraphRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const createKnowledgeEdgeRecord = buildCreateKnowledgeEdge({
  authorizeSource,
  clock,
  generateId: randomUUID,
  ontologyReader: knowledgeOntologyReader,
  repository: knowledgeGraphRepository
});

const searchKnowledgeNodeRecordsBase = buildSearchKnowledgeNodes({
  repository: knowledgeGraphRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export async function searchKnowledgeNodeRecords(
  access: OrganizationAccess,
  query: string,
  limit = 10,
  queryEmbedding?: MemoryEmbedding
) {
  return observeRetrieval("knowledge.search", access, limit, () =>
    searchKnowledgeNodeRecordsBase(access, query, limit, queryEmbedding)
  );
}

export const getKnowledgeNeighborhoodRecord =
  buildGetKnowledgeNeighborhood(knowledgeGraphRepository);

export const deleteKnowledgeNodeRecord =
  buildDeleteKnowledgeNode(knowledgeGraphRepository);

export const deleteKnowledgeEdgeRecord =
  buildDeleteKnowledgeEdge(knowledgeGraphRepository);

export const mergeKnowledgeNodeRecords = buildMergeKnowledgeNodes({
  clock,
  repository: knowledgeGraphRepository
});
