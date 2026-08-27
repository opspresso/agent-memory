import { describe, expect, it, vi } from "vitest";

import {
  buildAcceptKnowledgeCandidate,
  buildListKnowledgeCandidates,
  buildRejectKnowledgeCandidate,
  KnowledgeCandidateReviewAccessDeniedError,
  KnowledgeCandidateReviewConflictError
} from "@/application/knowledge/review-knowledge-candidate";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";

const now = new Date("2026-08-26T00:00:00.000Z");
const admin: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "admin-1",
  role: "admin",
  teams: []
};
const member: OrganizationAccess = { ...admin, role: "member" };
const candidate = createKnowledgeCandidate({
  id: "candidate-1",
  scope: { kind: "organization", organizationId: "organization-1" },
  documentId: "document-1",
  chunkId: "chunk-1",
  model: "model",
  graph: {
    entities: [
      { key: "api", kind: "service", canonicalName: "Memory API" },
      { key: "db", kind: "database", canonicalName: "PostgreSQL" }
    ],
    relationships: [
      { sourceKey: "api", targetKey: "db", predicate: "stores_in" }
    ]
  },
  now
});

function repository(
  overrides: Partial<KnowledgeCandidateRepository> = {}
): KnowledgeCandidateRepository {
  return {
    findById: vi.fn(),
    findByChunkId: vi.fn(),
    listPending: vi.fn(),
    save: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    ...overrides
  };
}

describe("knowledge candidate review", () => {
  it("passes reviewer scope to the pending candidate query", async () => {
    const candidates = repository({
      listPending: vi.fn().mockResolvedValue([candidate])
    });
    const list = buildListKnowledgeCandidates(candidates);

    await expect(list(admin, 25)).resolves.toEqual([candidate]);
    expect(candidates.listPending).toHaveBeenCalledWith(admin, 25);
  });

  it("prepares deterministic source-bound nodes and relationships for atomic promotion", async () => {
    const accept = vi.fn().mockImplementation(async (input) => ({
      candidate: { ...candidate, status: "accepted" },
      nodes: [],
      edges: [],
      input
    }));
    const candidates = repository({
      findById: vi.fn().mockResolvedValue(candidate),
      accept
    });
    const generateId = vi
      .fn()
      .mockReturnValueOnce("node-1")
      .mockReturnValueOnce("node-2")
      .mockReturnValueOnce("edge-1");
    const review = buildAcceptKnowledgeCandidate({
      clock: () => now,
      generateId,
      repository: candidates
    });

    await review(admin, candidate.id, "Verified against source");

    expect(accept).toHaveBeenCalledWith({
      candidateId: candidate.id,
      organizationId: "organization-1",
      reviewedAt: now,
      reviewedBy: "admin-1",
      reason: "Verified against source",
      entityPromotions: [
        { key: "api", id: "node-1" },
        { key: "db", id: "node-2" }
      ],
      relationshipIds: ["edge-1"]
    });
  });

  it("embeds candidate entities in one ordered batch", async () => {
    const accept = vi.fn().mockResolvedValue({
      candidate: { ...candidate, status: "accepted" },
      nodes: [],
      edges: []
    });
    const embedMany = vi.fn().mockResolvedValue([
      { model: "embedding-model", values: [1, 0] },
      { model: "embedding-model", values: [0, 1] }
    ]);
    const review = buildAcceptKnowledgeCandidate({
      clock: () => now,
      embeddingService: { embed: vi.fn(), embedMany },
      generateId: vi
        .fn()
        .mockReturnValueOnce("node-1")
        .mockReturnValueOnce("node-2")
        .mockReturnValueOnce("edge-1"),
      repository: repository({
        findById: vi.fn().mockResolvedValue(candidate),
        accept
      })
    });

    await review(admin, candidate.id);

    expect(embedMany).toHaveBeenCalledOnce();
    expect(embedMany).toHaveBeenCalledWith(["Memory API\n", "PostgreSQL\n"]);
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        entityPromotions: [
          {
            key: "api",
            id: "node-1",
            embedding: { model: "embedding-model", values: [1, 0] }
          },
          {
            key: "db",
            id: "node-2",
            embedding: { model: "embedding-model", values: [0, 1] }
          }
        ]
      })
    );
  });

  it("prevents a member from promoting an organization-scoped candidate", async () => {
    const candidates = repository({
      findById: vi.fn().mockResolvedValue(candidate)
    });
    const review = buildAcceptKnowledgeCandidate({
      clock: () => now,
      generateId: vi.fn(),
      repository: candidates
    });

    await expect(review(member, candidate.id)).rejects.toBeInstanceOf(
      KnowledgeCandidateReviewAccessDeniedError
    );
    expect(candidates.accept).not.toHaveBeenCalled();
  });

  it("rejects an already accepted candidate without changing it", async () => {
    const accepted = { ...candidate, status: "accepted" as const };
    const candidates = repository({
      findById: vi.fn().mockResolvedValue(accepted)
    });
    const reject = buildRejectKnowledgeCandidate({
      clock: () => now,
      repository: candidates
    });

    await expect(reject(admin, candidate.id)).rejects.toBeInstanceOf(
      KnowledgeCandidateReviewConflictError
    );
    expect(candidates.reject).not.toHaveBeenCalled();
  });

  it("records rejection provenance without creating graph resources", async () => {
    const rejected = {
      ...candidate,
      status: "rejected" as const,
      reviewedBy: "admin-1",
      reviewedAt: now
    };
    const candidates = repository({
      findById: vi.fn().mockResolvedValue(candidate),
      reject: vi.fn().mockResolvedValue(rejected)
    });
    const reject = buildRejectKnowledgeCandidate({
      clock: () => now,
      repository: candidates
    });

    await expect(reject(admin, candidate.id, "Unsupported inference")).resolves.toBe(
      rejected
    );
    expect(candidates.reject).toHaveBeenCalledWith({
      candidateId: candidate.id,
      organizationId: "organization-1",
      reason: "Unsupported inference",
      reviewedAt: now,
      reviewedBy: "admin-1"
    });
    expect(candidates.accept).not.toHaveBeenCalled();
  });
});
