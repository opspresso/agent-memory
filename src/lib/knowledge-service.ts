import { randomUUID } from "node:crypto";

import { buildCreateKnowledgeEdge } from "@/application/knowledge/create-knowledge-edge";
import { buildCreateKnowledgeNode } from "@/application/knowledge/create-knowledge-node";
import { buildGetKnowledgeNeighborhood } from "@/application/knowledge/get-knowledge-neighborhood";
import { buildSearchKnowledgeNodes } from "@/application/knowledge/search-knowledge-nodes";

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

export const searchKnowledgeNodeRecords = buildSearchKnowledgeNodes({
  repository: knowledgeGraphRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const getKnowledgeNeighborhoodRecord =
  buildGetKnowledgeNeighborhood(knowledgeGraphRepository);
