import { randomUUID } from "node:crypto";
import { buildQueueKnowledgeCuration, buildListKnowledgeCurationHistory } from "@/application/knowledge/queue-knowledge-curation";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import { buildAcceptKnowledgeCandidate, buildRejectKnowledgeCandidate } from "@/application/knowledge/review-knowledge-candidate";
import { knowledgeCandidateRepository, documentRepository, organizationAccessRepository, knowledgeGraphRepository,
  knowledgeOntologyReader, knowledgeVerificationService, textEmbeddingService, documentIngestionQueue } from "./container";

const clock = () => new Date();
export const listKnowledgeCurationHistory = buildListKnowledgeCurationHistory(knowledgeCandidateRepository);
export const queueKnowledgeCuration = knowledgeVerificationService ? buildQueueKnowledgeCuration(knowledgeCandidateRepository, documentIngestionQueue) : undefined;
const accept = buildAcceptKnowledgeCandidate({ clock, generateId: randomUUID, method: "automatic",
  repository: knowledgeCandidateRepository, ontologyReader: knowledgeOntologyReader,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {}) });
const reject = buildRejectKnowledgeCandidate({ clock, repository: knowledgeCandidateRepository, method: "automatic" });

export const curateKnowledgeCandidate = knowledgeVerificationService ? buildCurateKnowledgeCandidate({
  candidates: knowledgeCandidateRepository, documents: documentRepository, access: organizationAccessRepository,
  graph: knowledgeGraphRepository, ontology: knowledgeOntologyReader, verification: knowledgeVerificationService,
  accept, reject, clock
}) : undefined;
