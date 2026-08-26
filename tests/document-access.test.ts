import { describe, expect, it, vi } from "vitest";

import {
  buildGetDocument,
  DocumentNotFoundError
} from "@/application/document/get-document";
import {
  buildRetryDocument,
  DocumentNotRetryableError
} from "@/application/document/retry-document";
import {
  buildSearchDocuments,
  InvalidDocumentSearchError
} from "@/application/document/search-documents";
import { DocumentAccessDeniedError } from "@/application/document/upload-document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createDocument, type Document } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type { DocumentIngestionQueue } from "@/domain/document/document-services";

const now = new Date("2026-08-26T00:00:00.000Z");
const memberAccess: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};

function document(status: Document["status"] = "ready"): Document {
  return {
    ...createDocument({
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
    }),
    status
  };
}

function repository(overrides: Partial<DocumentRepository>): DocumentRepository {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findChunkById: vi.fn(),
    claimForProcessing: vi.fn(),
    completeProcessing: vi.fn(),
    failProcessing: vi.fn(),
    search: vi.fn(),
    ...overrides
  };
}

describe("document access", () => {
  it("hides a document outside the caller scope", async () => {
    const inaccessible = {
      ...document(),
      scope: {
        kind: "team" as const,
        organizationId: "organization-1",
        teamId: "team-2"
      }
    };
    const getDocument = buildGetDocument(
      repository({ findById: vi.fn().mockResolvedValue(inaccessible) })
    );

    await expect(
      getDocument(memberAccess, inaccessible.id)
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it("embeds a normalized query and filters repository results defensively", async () => {
    const accessible = document();
    const inaccessible = {
      ...accessible,
      id: "document-2",
      scope: {
        kind: "user" as const,
        organizationId: "organization-1",
        userId: "user-2"
      }
    };
    const search = vi.fn().mockResolvedValue([
      { document: accessible, chunk: {}, score: 1 },
      { document: inaccessible, chunk: {}, score: 0.5 }
    ]);
    const embed = vi
      .fn()
      .mockResolvedValue({ model: "embedding-model", values: [1, 0] });
    const searchDocuments = buildSearchDocuments({
      repository: repository({ search }),
      embeddingService: { embed, embedMany: vi.fn() }
    });

    await expect(searchDocuments(memberAccess, "  rollback  ", 5)).resolves.toEqual([
      expect.objectContaining({ document: accessible })
    ]);
    expect(embed).toHaveBeenCalledWith("rollback");
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        access: memberAccess,
        query: "rollback",
        limit: 5,
        queryEmbedding: { model: "embedding-model", values: [1, 0] }
      })
    );
  });

  it("validates search limits before querying persistence", async () => {
    const search = vi.fn();
    const searchDocuments = buildSearchDocuments({
      repository: repository({ search })
    });

    await expect(
      searchDocuments(memberAccess, "rollback", 101)
    ).rejects.toBeInstanceOf(InvalidDocumentSearchError);
    expect(search).not.toHaveBeenCalled();
  });

  it("only enqueues failed documents writable by the caller", async () => {
    const enqueue = vi.fn();
    const queue: DocumentIngestionQueue = { enqueue };
    const failed = document("failed");
    const retryDocument = buildRetryDocument({
      queue,
      repository: repository({ findById: vi.fn().mockResolvedValue(failed) })
    });

    await expect(retryDocument(memberAccess, failed.id)).resolves.toBe(failed);
    expect(enqueue).toHaveBeenCalledWith("organization-1", failed.id);
  });

  it("rejects retry for a non-failed or non-writable document", async () => {
    const queue: DocumentIngestionQueue = { enqueue: vi.fn() };
    const readyRetry = buildRetryDocument({
      queue,
      repository: repository({ findById: vi.fn().mockResolvedValue(document()) })
    });
    await expect(
      readyRetry(memberAccess, "document-1")
    ).rejects.toBeInstanceOf(DocumentNotRetryableError);

    const organizationDocument = {
      ...document("failed"),
      scope: {
        kind: "organization" as const,
        organizationId: "organization-1"
      }
    };
    const forbiddenRetry = buildRetryDocument({
      queue,
      repository: repository({
        findById: vi.fn().mockResolvedValue(organizationDocument)
      })
    });
    await expect(
      forbiddenRetry(memberAccess, organizationDocument.id)
    ).rejects.toBeInstanceOf(DocumentAccessDeniedError);
  });
});
