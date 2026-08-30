import {
  InvalidKnowledgeCandidateReviewError,
  KnowledgeCandidateNotFoundError,
  KnowledgeCandidateReviewAccessDeniedError,
  KnowledgeCandidateReviewConflictError,
  type AcceptKnowledgeCandidateResult
} from "@/application/knowledge/review-knowledge-candidate";
import type { KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { KnowledgeOntologyViolationError } from "@/domain/knowledge/knowledge-ontology";

import { aiErrorResponse } from "./ai-http";
import { publicKnowledgeEdge, publicKnowledgeNode } from "./knowledge-http";

export function knowledgeCandidateErrorResponse(error: unknown): Response | null {
  const aiResponse = aiErrorResponse(error);
  if (aiResponse) {
    return aiResponse;
  }
  if (error instanceof KnowledgeCandidateNotFoundError) {
    return Response.json({ error: "Knowledge candidate not found" }, { status: 404 });
  }
  if (error instanceof KnowledgeCandidateReviewAccessDeniedError) {
    return Response.json(
      { error: "Knowledge candidate review access denied" },
      { status: 403 }
    );
  }
  if (error instanceof KnowledgeCandidateReviewConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof KnowledgeOntologyViolationError) {
    return Response.json(
      { error: "knowledge ontology violation", violations: error.violations },
      { status: 422 }
    );
  }
  if (error instanceof InvalidKnowledgeCandidateReviewError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
}

export function publicKnowledgeCandidate(candidate: KnowledgeCandidate) {
  return {
    id: candidate.id,
    scope: candidate.scope,
    documentId: candidate.documentId,
    chunkId: candidate.chunkId,
    model: candidate.model,
    graph: candidate.graph,
    status: candidate.status,
    ...(candidate.reviewedBy ? { reviewedBy: candidate.reviewedBy } : {}),
    ...(candidate.reviewReason
      ? { reviewReason: candidate.reviewReason }
      : {}),
    ...(candidate.reviewedAt ? { reviewedAt: candidate.reviewedAt } : {}),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

export function publicKnowledgeCandidatePromotion(
  result: AcceptKnowledgeCandidateResult
) {
  return {
    candidate: publicKnowledgeCandidate(result.candidate),
    nodes: result.nodes.map(publicKnowledgeNode),
    edges: result.edges.map(publicKnowledgeEdge),
    ...(result.ontologyWarnings.length > 0
      ? { ontologyWarnings: result.ontologyWarnings }
      : {})
  };
}
