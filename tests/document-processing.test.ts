import { describe, expect, it, vi } from "vitest";

import {
  chunkDocumentText,
  chunkText
} from "@/application/document/chunk-text";
import { buildProcessDocument } from "@/application/document/process-document";
import { buildUploadDocument } from "@/application/document/upload-document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createDocument } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type {
  DocumentIngestionQueue,
  DocumentObjectStorage
} from "@/domain/document/document-services";
import {
  createPlainTextExtractor,
  UnsupportedDocumentTypeError
} from "@/infrastructure/document/plain-text-extractor";

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
    findChunkById: vi.fn(),
    listChunksByDocument: vi.fn(),
    claimForProcessing: vi.fn(),
    completeProcessing: vi.fn(),
    failProcessing: vi.fn(),
    markEnqueueFailure: vi.fn(),
    archive: vi.fn(),
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
  it("extracts supported UTF-8 text and normalizes JSON", async () => {
    const extractor = createPlainTextExtractor();

    await expect(
      extractor.extract(
        new TextEncoder().encode('{"rollback":true}'),
        "application/json; charset=utf-8"
      )
    ).resolves.toBe('{\n  "rollback": true\n}');
    await expect(
      extractor.extract(new Uint8Array([0, 1, 2]), "application/pdf")
    ).rejects.toBeInstanceOf(UnsupportedDocumentTypeError);
  });

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

  it("preserves Markdown heading context across chunks", () => {
    const chunks = chunkDocumentText(
      `### Agent Studio\n\n${"production AI agent platform ".repeat(100)}`,
      "text/markdown"
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.startsWith("### Agent Studio")))
      .toBe(true);
    expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
  });

  it("preserves CSV headers across record-aligned chunks", () => {
    const chunks = chunkDocumentText(
      ["name,url,description", ...Array.from({ length: 100 }, (_, index) =>
        `Agent ${index},https://example.test/${index},${"platform ".repeat(5)}`
      )].join("\n"),
      "text/csv"
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.startsWith("name,url,description\n")))
      .toBe(true);
    expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
  });

  it("preserves JSON paths as extraction context", () => {
    const chunks = chunkDocumentText(
      JSON.stringify({ products: [{ name: "Agent Studio", url: "https://studio.opspresso.com" }] }),
      "application/json"
    );

    expect(chunks).toEqual([
      expect.objectContaining({
        content: [
          '$.products[0].name = "Agent Studio"',
          '$.products[0].url = "https://studio.opspresso.com"'
        ].join("\n")
      })
    ]);
  });

  it("preserves XML ancestor paths across chunks", () => {
    const chunks = chunkDocumentText(
      `<portfolio><product><name>Agent Studio</name><description>${"AI platform ".repeat(220)}</description></product></portfolio>`,
      "application/xml"
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]?.content).toContain("XML context: /portfolio/product/description");
    expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
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

  it("does not persist metadata when object storage fails", async () => {
    const storageFailure = new Error("object storage unavailable");
    const save = vi.fn<DocumentRepository["save"]>();
    const storage = objectStorage({
      put: vi.fn().mockRejectedValue(storageFailure)
    });
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      objectStorage: storage,
      queue: { enqueue: vi.fn() },
      repository: repository({ save })
    });

    await expect(
      upload({
        access,
        scope: { kind: "user", organizationId: "organization-1", userId: "user-1" },
        title: "Runbook",
        mimeType: "text/plain",
        content: new TextEncoder().encode("Rollback safely")
      })
    ).rejects.toBe(storageFailure);
    expect(save).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("removes the source object when metadata persistence fails", async () => {
    const persistenceFailure = new Error("database unavailable");
    const storage = objectStorage();
    const enqueue = vi.fn();
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      objectStorage: storage,
      queue: { enqueue },
      repository: repository({
        save: vi.fn().mockRejectedValue(persistenceFailure)
      })
    });

    await expect(
      upload({
        access,
        scope: { kind: "user", organizationId: "organization-1", userId: "user-1" },
        title: "Runbook",
        mimeType: "text/plain",
        content: new TextEncoder().encode("Rollback safely")
      })
    ).rejects.toBe(persistenceFailure);
    expect(storage.delete).toHaveBeenCalledWith(
      "organizations/organization-1/documents/document-1/source"
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("preserves persistence and cleanup failures together", async () => {
    const persistenceFailure = new Error("database unavailable");
    const cleanupFailure = new Error("object cleanup unavailable");
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      objectStorage: objectStorage({
        delete: vi.fn().mockRejectedValue(cleanupFailure)
      }),
      queue: { enqueue: vi.fn() },
      repository: repository({
        save: vi.fn().mockRejectedValue(persistenceFailure)
      })
    });

    const result = upload({
      access,
      scope: { kind: "user", organizationId: "organization-1", userId: "user-1" },
      title: "Runbook",
      mimeType: "text/plain",
      content: new TextEncoder().encode("Rollback safely")
    });
    await expect(result).rejects.toThrow(
      "document persistence and object cleanup both failed"
    );
    await expect(result).rejects.toMatchObject({
      errors: [persistenceFailure, cleanupFailure]
    });
  });

  it("returns a retryable document identity when enqueue fails", async () => {
    const markEnqueueFailure = vi.fn<
      DocumentRepository["markEnqueueFailure"]
    >();
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      objectStorage: objectStorage(),
      queue: {
        enqueue: vi.fn().mockRejectedValue(new Error("queue unavailable"))
      },
      repository: repository({ markEnqueueFailure })
    });

    await expect(
      upload({
        access,
        scope: { kind: "user", organizationId: "organization-1", userId: "user-1" },
        title: "Runbook",
        mimeType: "text/plain",
        content: new TextEncoder().encode("Rollback safely")
      })
    ).resolves.toMatchObject({ id: "document-1", status: "failed" });
    expect(markEnqueueFailure).toHaveBeenCalledWith(
      "organization-1",
      "document-1",
      "failed to enqueue document ingestion",
      now
    );
  });

  it("preserves enqueue and failure-status errors together", async () => {
    const enqueueFailure = new Error("queue unavailable");
    const statusFailure = new Error("database unavailable");
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      objectStorage: objectStorage(),
      queue: { enqueue: vi.fn().mockRejectedValue(enqueueFailure) },
      repository: repository({
        markEnqueueFailure: vi.fn().mockRejectedValue(statusFailure)
      })
    });

    const result = upload({
      access,
      scope: { kind: "user", organizationId: "organization-1", userId: "user-1" },
      title: "Runbook",
      mimeType: "text/plain",
      content: new TextEncoder().encode("Rollback safely")
    });
    await expect(result).rejects.toThrow(
      "document enqueue and failure status update both failed"
    );
    await expect(result).rejects.toMatchObject({
      errors: [enqueueFailure, statusFailure]
    });
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
        claimForProcessing: vi.fn().mockResolvedValue({
          document,
          leaseId: "lease-1"
        }),
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
      { document, leaseId: "lease-1" },
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
        claimForProcessing: vi.fn().mockResolvedValue({
          document,
          leaseId: "lease-1"
        }),
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
      { document, leaseId: "lease-1" },
      "document processing failed",
      now
    );
  });

  it("treats an already processed job as an idempotent success", async () => {
    const storage = objectStorage();
    const process = buildProcessDocument({
      clock: () => now,
      generateId: () => "chunk-1",
      objectStorage: storage,
      repository: repository({
        claimForProcessing: vi.fn().mockResolvedValue(null)
      }),
      textExtractor: { extract: vi.fn() }
    });

    await expect(
      process("organization-1", "document-1")
    ).resolves.toBeUndefined();
    expect(storage.get).not.toHaveBeenCalled();
  });
});
