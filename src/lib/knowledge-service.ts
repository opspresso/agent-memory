import { randomUUID } from "node:crypto";

import { buildCreateKnowledgeEdge } from "@/application/knowledge/create-knowledge-edge";
import { buildCreateKnowledgeNode } from "@/application/knowledge/create-knowledge-node";
import { buildGetKnowledgeNeighborhood } from "@/application/knowledge/get-knowledge-neighborhood";
import { buildSearchKnowledgeNodes } from "@/application/knowledge/search-knowledge-nodes";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { observeRetrieval } from "@/infrastructure/observability/telemetry";

import { knowledgeGraphRepository, textEmbeddingService } from "./container";

const clock = () => new Date();

export const createKnowledgeNodeRecord = buildCreateKnowledgeNode({
  clock,
  generateId: randomUUID,
  repository: knowledgeGraphRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const createKnowledgeEdgeRecord = buildCreateKnowledgeEdge({
  clock,
  generateId: randomUUID,
  repository: knowledgeGraphRepository
});

const searchKnowledgeNodeRecordsBase = buildSearchKnowledgeNodes({
  repository: knowledgeGraphRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export async function searchKnowledgeNodeRecords(
  access: OrganizationAccess,
  query: string,
  limit = 10
) {
  return observeRetrieval("knowledge.search", access, limit, () =>
    searchKnowledgeNodeRecordsBase(access, query, limit)
  );
}

export const getKnowledgeNeighborhoodRecord =
  buildGetKnowledgeNeighborhood(knowledgeGraphRepository);
