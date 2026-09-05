import { describe, expect, it, vi } from "vitest";

import {
  buildAuthorizeKnowledgeSource,
  KnowledgeSourceNotFoundError
} from "@/application/knowledge/authorize-knowledge-source";
import {
  createDocument,
  createDocumentChunk
} from "@/domain/document/document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createMemory } from "@/domain/memory/memory";

const now = new Date("2026-08-26T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};

function memory(teamId = "team-1") {
  return createMemory({
    id: "memory-1",
    kind: "fact",
    scope: { kind: "team", organizationId: "organization-1", teamId },
    title: "Checkout owner",
    content: "Payments owns checkout.",
    source: { type: "user" },
    createdBy: "user-1",
    validFrom: now,
    now
  });
}

function chunkRecord() {
  const document = {
    ...createDocument({
      id: "document-1",
      scope: {
        kind: "team" as const,
        organizationId: "organization-1",
        teamId: "team-1"
      },
      title: "Runbook",
      objectKey: "documents/document-1/source",
      checksum: "a".repeat(64),
      mimeType: "text/plain",
      sizeBytes: 32,
      createdBy: "user-1",
      now
    }),
    status: "ready" as const
  };
  return {
    document,
    chunk: createDocumentChunk({
      id: "chunk-1",
      organizationId: "organization-1",
      documentId: document.id,
      ordinal: 0,
      content: "Rollback requires two approvers.",
      now
    })
  };
}

describe("knowledge source authorization", () => {
  it.each([
    { status: "archived" as const },
    { validFrom: new Date(now.getTime() + 1) },
    { expiresAt: now },
    { expiresAt: new Date(now.getTime() - 1) }
  ])("rejects a memory source that is not currently valid: %j", async (override) => {
    const authorize = buildAuthorizeKnowledgeSource({
      clock: () => now,
      memoryRepository: {
        findById: vi.fn().mockResolvedValue({ ...memory(), ...override })
      },
      documentRepository: { findChunkById: vi.fn() }
    });

    await expect(
      authorize(access, { memoryId: "memory-1" }, memory().scope)
    ).rejects.toBeInstanceOf(KnowledgeSourceNotFoundError);
  });

  it("allows readable memory and document chunk references", async () => {
    const findById = vi.fn().mockResolvedValue(memory());
    const findChunkById = vi.fn().mockResolvedValue(chunkRecord());
    const authorize = buildAuthorizeKnowledgeSource({
      clock: () => now,
      memoryRepository: { findById },
      documentRepository: { findChunkById }
    });

    await expect(
      authorize(access, { memoryId: "memory-1" }, memory().scope)
    ).resolves.toBeUndefined();
    await expect(
      authorize(access, { chunkId: "chunk-1" }, chunkRecord().document.scope)
    ).resolves.toBeUndefined();
    expect(findById).toHaveBeenCalledWith("organization-1", "memory-1");
    expect(findChunkById).toHaveBeenCalledWith("organization-1", "chunk-1");
  });

  it("hides a source outside the caller read scope", async () => {
    const authorize = buildAuthorizeKnowledgeSource({
      clock: () => now,
      memoryRepository: { findById: vi.fn().mockResolvedValue(memory("team-2")) },
      documentRepository: { findChunkById: vi.fn() }
    });

    await expect(
      authorize(access, { memoryId: "memory-1" }, memory().scope)
    ).rejects.toBeInstanceOf(KnowledgeSourceNotFoundError);
  });

  it("prevents a source from being exposed at a broader scope", async () => {
    const authorize = buildAuthorizeKnowledgeSource({
      clock: () => now,
      memoryRepository: { findById: vi.fn().mockResolvedValue(memory()) },
      documentRepository: { findChunkById: vi.fn() }
    });

    await expect(
      authorize(
        access,
        { memoryId: "memory-1" },
        { kind: "organization", organizationId: "organization-1" }
      )
    ).rejects.toBeInstanceOf(KnowledgeSourceNotFoundError);
  });
});
