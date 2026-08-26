import { describe, expect, it, vi } from "vitest";

import { chunkText } from "@/application/document/chunk-text";
import { buildProcessDocument } from "@/application/document/process-document";
import { buildUploadDocument } from "@/application/document/upload-document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createDocument } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type {
  DocumentIngestionQueue,
  DocumentObjectStorage
} from "@/domain/document/document-services";

const now = new Date("2026-08-26T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};

function repository(overrides: Partial<DocumentRepository> = {}): DocumentRepository {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    claimForProcessing: vi.fn(),
    completeProcessing: vi.fn(),
    failProcessing: vi.fn(),
    search: vi.fn(),
    ...overrides
  };
}

function objectStorage(
  overrides: Partial<DocumentObjectStorage> = {}
): DocumentObjectStorage {
  return {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    ...overrides
  };
}

describe("document processing", () => {
  it("chunks normalized text deterministically with bounded overlap", () => {
    const text = `${"alpha ".repeat(30)}\r\n\r\n${"beta ".repeat(30)}`;
    const chunks = chunkText(text, {
      maxCharacters: 120,
      overlapCharacters: 20
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.content.length <= 120)).toBe(true);
    expect(chunks.map((chunk) => chunk.start)).toEqual(
      [...chunks.map((chunk) => chunk.start)].sort((left, right) => left - right)
    );
  });

  it("stores source bytes before persisting and enqueuing metadata", async () => {
    const storage = objectStorage();
    const save = vi.fn<DocumentRepository["save"]>();
    const queue: DocumentIngestionQueue = { enqueue: vi.fn() };
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      objectStorage: storage,
      queue,
      repository: repository({ save })
    });

    const document = await upload({
      access,
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-1"
      },
      title: "Runbook",
      mimeType: "text/markdown",
      content: new TextEncoder().encode("# Rollback")
    });

    expect(document).toMatchObject({
      id: "document-1",
      status: "pending",
      createdBy: "user-1",
      objectKey: "organizations/organization-1/documents/document-1/source"
    });
    expect(storage.put).toHaveBeenCalledBefore(save);
    expect(save).toHaveBeenCalledBefore(queue.enqueue as ReturnType<typeof vi.fn>);
  });

  it("extracts, chunks, embeds, and completes a claimed document", async () => {
    const document = createDocument({
      id: "document-1",
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-1"
      },
      title: "Runbook",
      objectKey: "objects/document-1",
      checksum: "a".repeat(64),
      mimeType: "text/plain",
      sizeBytes: 8,
      createdBy: "user-1",
      now
    });
    const completeProcessing = vi.fn<DocumentRepository["completeProcessing"]>();
    const process = buildProcessDocument({
      clock: () => now,
      generateId: () => "chunk-1",
      objectStorage: objectStorage({
        get: vi.fn().mockResolvedValue(new TextEncoder().encode("Rollback safely"))
      }),
      repository: repository({
        claimForProcessing: vi.fn().mockResolvedValue(document),
        completeProcessing
      }),
      textExtractor: {
        extract: vi.fn().mockResolvedValue("Rollback safely")
      },
      embeddingService: {
        embed: vi.fn(),
        embedMany: vi
          .fn()
          .mockResolvedValue([{ model: "embedding-model", values: [1, 0] }])
      }
    });

    await process("organization-1", "document-1");

    expect(completeProcessing).toHaveBeenCalledWith(
      document,
      [
        expect.objectContaining({
          id: "chunk-1",
          content: "Rollback safely",
          embedding: { model: "embedding-model", values: [1, 0] }
        })
      ],
      now
    );
  });

  it("records a bounded failure when extraction fails", async () => {
    const document = createDocument({
      id: "document-1",
      scope: { kind: "organization", organizationId: "organization-1" },
      title: "Unreadable",
      objectKey: "objects/document-1",
      checksum: "a".repeat(64),
      mimeType: "text/plain",
      sizeBytes: 8,
      createdBy: "user-1",
      now
    });
    const failProcessing = vi.fn<DocumentRepository["failProcessing"]>();
    const process = buildProcessDocument({
      clock: () => now,
      generateId: () => "chunk-1",
      objectStorage: objectStorage({
        get: vi.fn().mockResolvedValue(new TextEncoder().encode("content"))
      }),
      repository: repository({
        claimForProcessing: vi.fn().mockResolvedValue(document),
        failProcessing
      }),
      textExtractor: {
        extract: vi.fn().mockRejectedValue(new Error("extractor failed"))
      }
    });

    await expect(process("organization-1", "document-1")).rejects.toThrow(
      "extractor failed"
    );
    expect(failProcessing).toHaveBeenCalledWith(
      "organization-1",
      "document-1",
      "extractor failed",
      now
    );
  });
});
