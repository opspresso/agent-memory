import { describe, expect, it } from "vitest";

import { createDocument } from "@/domain/document/document";
import { DocumentQuotaExceededError } from "@/application/document/upload-document";
import {
  boundedFormData,
  documentErrorResponse,
  DocumentUploadTooLargeError,
  parseMetadata,
  publicDocument
} from "@/lib/document-http";
import { documentUploadFieldsSchema } from "@/lib/document-schemas";
import { readDocumentUploadLimits } from "@/lib/document-upload-limits";

describe("document HTTP boundary", () => {
  it("validates scope-specific upload fields", () => {
    expect(
      documentUploadFieldsSchema.safeParse({
        scopeKind: "team",
        title: "Runbook",
        mimeType: "text/markdown"
      }).success
    ).toBe(false);
    expect(
      documentUploadFieldsSchema.safeParse({
        scopeKind: "organization",
        teamId: "6b16dd4c-c599-46b0-9af7-35db8f4bdc16",
        title: "Runbook",
        mimeType: "text/markdown"
      }).success
    ).toBe(false);
    expect(
      documentUploadFieldsSchema.safeParse({
        scopeKind: "team",
        teamId: "6b16dd4c-c599-46b0-9af7-35db8f4bdc16",
        title: "Runbook",
        mimeType: "application/pdf"
      }).success
    ).toBe(false);
  });

  it("accepts only JSON objects as form metadata", () => {
    expect(parseMetadata('{"environment":"production"}')).toEqual({
      valid: true,
      value: { environment: "production" }
    });
    expect(parseMetadata("[]")).toEqual({ valid: false });
    expect(parseMetadata("invalid")).toEqual({ valid: false });
    expect(
      documentUploadFieldsSchema.safeParse({
        scopeKind: "organization",
        title: "Runbook",
        mimeType: "text/plain",
        metadata: { value: "한".repeat(11_000) }
      }).success
    ).toBe(false);
  });

  it("bounds the actual multipart stream without trusting Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      }
    });
    const request = new Request("http://localhost/documents", {
      method: "POST",
      headers: {
        "Content-Length": "1",
        "Content-Type": "multipart/form-data; boundary=test"
      },
      body,
      duplex: "half"
    } as RequestInit & { duplex: "half" });

    await expect(boundedFormData(request, 10)).rejects.toBeInstanceOf(
      DocumentUploadTooLargeError
    );
    expect(cancelled).toBe(true);
  });

  it("omits the object key and error from non-failed public documents", () => {
    const document = {
      ...createDocument({
        id: "document-1",
        scope: { kind: "organization", organizationId: "organization-1" },
        title: "Runbook",
        objectKey: "secret/internal/object-key",
        checksum: "a".repeat(64),
        mimeType: "text/plain",
        sizeBytes: 8,
        createdBy: "user-1",
        now: new Date("2026-08-26T00:00:00.000Z")
      }),
      errorMessage: "previous failure"
    };

    expect(publicDocument(document)).not.toHaveProperty("objectKey");
    expect(publicDocument(document)).not.toHaveProperty("processingError");
  });

  it("validates durable upload limits and reports quota failures", async () => {
    expect(
      readDocumentUploadLimits({
        DOCUMENT_STORAGE_QUOTA_BYTES: "2048",
        DOCUMENT_PENDING_QUOTA: "3",
        DOCUMENT_UPLOADS_PER_USER_PER_HOUR: "4"
      })
    ).toEqual({
      maximumOrganizationStorageBytes: 2_048,
      maximumPendingDocuments: 3,
      maximumUserUploadsPerHour: 4
    });
    expect(() =>
      readDocumentUploadLimits({ DOCUMENT_PENDING_QUOTA: "0" })
    ).toThrow("DOCUMENT_PENDING_QUOTA must be a positive safe integer");

    const response = documentErrorResponse(
      new DocumentQuotaExceededError("pending_documents_exceeded")
    );
    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toEqual({
      error: "Organization pending document quota exceeded"
    });
  });
});
