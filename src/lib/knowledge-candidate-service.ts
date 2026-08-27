import { randomUUID } from "node:crypto";

import {
  buildAcceptKnowledgeCandidate,
  buildFindKnowledgeCandidateDuplicates,
  buildListKnowledgeCandidates,
  buildRejectKnowledgeCandidate
} from "@/application/knowledge/review-knowledge-candidate";

import {
  knowledgeCandidateRepository,
  knowledgeGraphRepository,
  textEmbeddingService
} from "./container";

const clock = () => new Date();

export const listKnowledgeCandidateRecords = buildListKnowledgeCandidates(
  knowledgeCandidateRepository
);

export const findKnowledgeCandidateDuplicateRecords =
  buildFindKnowledgeCandidateDuplicates({
    candidateRepository: knowledgeCandidateRepository,
    graphRepository: knowledgeGraphRepository
  });

export const acceptKnowledgeCandidateRecord = buildAcceptKnowledgeCandidate({
  clock,
  generateId: randomUUID,
  repository: knowledgeCandidateRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const rejectKnowledgeCandidateRecord = buildRejectKnowledgeCandidate({
  clock,
  repository: knowledgeCandidateRepository
});
