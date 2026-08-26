import { describe, expect, it } from "vitest";

import { createDocument } from "@/domain/document/document";
import { parseMetadata, publicDocument } from "@/lib/document-http";
import { documentUploadFieldsSchema } from "@/lib/document-schemas";

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
});
