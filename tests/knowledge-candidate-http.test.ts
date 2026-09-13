import { describe, expect, it } from "vitest";

import {
  InvalidKnowledgeCandidateReviewError,
  KnowledgeCandidateNotFoundError,
  KnowledgeCandidateReviewAccessDeniedError,
  KnowledgeCandidateReviewConflictError
} from "@/application/knowledge/review-knowledge-candidate";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { KnowledgeOntologyViolationError } from "@/domain/knowledge/knowledge-ontology";
import { AmbiguousKnowledgeIdentityError } from "@/domain/knowledge/knowledge-alias";
import {
  knowledgeCandidateErrorResponse,
  publicKnowledgeCandidate
} from "@/lib/knowledge-candidate-http";
import { reviewKnowledgeCandidateSchema } from "@/lib/knowledge-schemas";

describe("knowledge candidate HTTP boundary", () => {
  it("returns reviewable graph data without source chunk content", () => {
    const candidate = createKnowledgeCandidate({
      id: "80000000-0000-0000-0000-000000000001",
      scope: {
        kind: "organization",
        organizationId: "00000000-0000-0000-0000-000000000001"
      },
      documentId: "40000000-0000-0000-0000-000000000001",
      chunkId: "50000000-0000-0000-0000-000000000001",
      model: "extractor",
      graph: {
        entities: [{ key: "api", kind: "service", canonicalName: "API" }],
        relationships: []
      },
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(publicKnowledgeCandidate(candidate)).toMatchObject({
      chunkId: candidate.chunkId,
      graph: candidate.graph,
      status: "pending"
    });
    expect(publicKnowledgeCandidate(candidate)).not.toHaveProperty("content");
  });

  it("validates bounded optional review reasons", () => {
    expect(reviewKnowledgeCandidateSchema.safeParse({}).success).toBe(true);
    expect(
      reviewKnowledgeCandidateSchema.safeParse({ reason: "verified" }).success
    ).toBe(true);
    expect(
      reviewKnowledgeCandidateSchema.safeParse({ reason: "x".repeat(2_001) })
        .success
    ).toBe(false);
  });

  it.each([
    [new KnowledgeCandidateNotFoundError(), 404],
    [new KnowledgeCandidateReviewAccessDeniedError(), 403],
    [new KnowledgeCandidateReviewConflictError(), 409],
    [new AmbiguousKnowledgeIdentityError(["person"]), 409],
    [
      new KnowledgeOntologyViolationError([
        { type: "unknown_kind", term: "gadget" }
      ]),
      422
    ],
    [new InvalidKnowledgeCandidateReviewError("invalid"), 400]
  ])("maps review errors without leaking internal data", (error, status) => {
    expect(knowledgeCandidateErrorResponse(error)?.status).toBe(status);
  });

  it("includes the violations in a strict ontology rejection body", async () => {
    const response = knowledgeCandidateErrorResponse(
      new KnowledgeOntologyViolationError([
        { type: "unknown_kind", term: "gadget" }
      ])
    );

    await expect(response?.json()).resolves.toEqual({
      error: "knowledge ontology violation",
      violations: [{ type: "unknown_kind", term: "gadget" }]
    });
  });
});
