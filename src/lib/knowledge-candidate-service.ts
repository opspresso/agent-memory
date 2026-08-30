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
  knowledgeOntologyReader,
  textEmbeddingService
} from "./container";

const clock = () => new Date();

export const listKnowledgeCandidateRecords = buildListKnowledgeCandidates(
  knowledgeCandidateRepository
);

export const findKnowledgeCandidateDuplicateRecords =
  buildFindKnowledgeCandidateDuplicates({
    candidateRepository: knowledgeCandidateRepository,
    graphRepository: knowledgeGraphRepository,
    ontologyReader: knowledgeOntologyReader
  });

export const acceptKnowledgeCandidateRecord = buildAcceptKnowledgeCandidate({
  clock,
  generateId: randomUUID,
  ontologyReader: knowledgeOntologyReader,
  repository: knowledgeCandidateRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const rejectKnowledgeCandidateRecord = buildRejectKnowledgeCandidate({
  clock,
  repository: knowledgeCandidateRepository
});
