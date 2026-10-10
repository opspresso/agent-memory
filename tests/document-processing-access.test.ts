import { describe, expect, it, vi } from "vitest";
import { buildProcessDocument } from "@/application/document/process-document";
import { createDocument, type DocumentScope } from "@/domain/document/document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

const now = new Date("2026-10-10T00:00:00Z");
const owner: OrganizationAccess = { organizationId: "org", userId: "retry-user", role: "owner", teams: [] };

function fixture(content = "Atlas uses Orion.", scope: DocumentScope = { organizationId: "org", kind: "organization" }) {
  const document = { ...createDocument({ id: "doc", scope,
    title: "Source", objectKey: "source", checksum: "a".repeat(64), mimeType: "text/plain",
    sizeBytes: 10, createdBy: "original-uploader", now }), status: "processing" as const, processingAttempts: 1 };
  const findById = vi.fn().mockResolvedValue(document);
  const findByUser = vi.fn().mockResolvedValue(owner);
  const get = vi.fn().mockResolvedValue(new TextEncoder().encode(content));
  const extract = vi.fn().mockResolvedValue({ text: content, mimeType: "text/plain" });
  const embedMany = vi.fn(async (texts: readonly string[]) => texts.map(() => ({ model: "embedding", values: [1, 0] })));
  const completeProcessing = vi.fn(), failProcessing = vi.fn();
  const run = buildProcessDocument({ clock: () => now, generateId: () => "chunk",
    accessRepository: { findByUser }, objectStorage: { get, put: vi.fn(), delete: vi.fn() },
    textExtractor: { extract }, embeddingService: { embed: vi.fn(), embedMany },
    repository: { findById, claimForProcessing: vi.fn().mockResolvedValue({ document, leaseId: "lease" }),
      completeProcessing, failProcessing } });
  return { run, document, findById, findByUser, get, extract, embedMany, completeProcessing, failProcessing };
}

describe("document processing authorization", () => {
  it.each([null, { ...owner, role: "member" as const }, { ...owner, organizationId: "other" }])(
    "checks the current requester before reading stored bytes: %j", async (access) => {
      const test = fixture();
      test.findByUser.mockResolvedValue(access);
      await expect(test.run("org", "doc", "doc", "retry-user")).rejects.toThrow("document access denied");
      expect(test.get).not.toHaveBeenCalled();
      expect(test.extract).not.toHaveBeenCalled();
      expect(test.embedMany).not.toHaveBeenCalled();
      expect(test.completeProcessing).not.toHaveBeenCalled();
    }
  );

  it("charges the retry requester instead of the original uploader", async () => {
    const test = fixture();
    await test.run("org", "doc", "doc", "retry-user");
    expect(test.findByUser).toHaveBeenCalledWith("org", "retry-user");
    expect(test.embedMany).toHaveBeenCalledWith(["Atlas uses Orion."], { organizationId: "org", userId: "retry-user" });
    expect(test.completeProcessing).toHaveBeenCalledOnce();
  });

  it("preserves a team member's write permission for document processing", async () => {
    const test = fixture(undefined, { organizationId: "org", kind: "team", teamId: "team" });
    test.findByUser.mockResolvedValue({ ...owner, role: "member", teams: [{ teamId: "team", role: "member" }] });
    await test.run("org", "doc", "doc", "retry-user");
    expect(test.completeProcessing).toHaveBeenCalledOnce();
  });

  it("stops before embedding when membership changes during conversion", async () => {
    const test = fixture();
    test.extract.mockImplementation(async () => {
      test.findByUser.mockResolvedValue(null);
      return { text: "Atlas uses Orion.", mimeType: "text/plain" };
    });
    await expect(test.run("org", "doc", "doc", "retry-user")).rejects.toThrow("document access denied");
    expect(test.embedMany).not.toHaveBeenCalled();
    expect(test.completeProcessing).not.toHaveBeenCalled();
  });

  it.each(["membership", "archived", "generation", "lease"])("rechecks %s before each embedding batch", async (change) => {
    const test = fixture(Array.from({ length: 130 }, () => "x".repeat(2_000)).join("\n"));
    test.embedMany.mockImplementation(async (texts) => {
      if (change === "membership") test.findByUser.mockResolvedValue(null);
      else test.findById.mockResolvedValue({ ...test.document,
        ...(change === "archived" ? { status: "archived" } : {}),
        ...(change === "generation" ? { processingGeneration: "new-request" } : {}),
        ...(change === "lease" ? { processingAttempts: 2 } : {}) });
      return texts.map(() => ({ model: "embedding", values: [1, 0] }));
    });
    await expect(test.run("org", "doc", "doc", "retry-user")).rejects.toThrow();
    expect(test.embedMany).toHaveBeenCalledOnce();
    expect(test.completeProcessing).not.toHaveBeenCalled();
  });

  it("does not publish chunks after access is revoked during the last embedding request", async () => {
    const test = fixture();
    test.embedMany.mockImplementation(async (texts) => {
      test.findByUser.mockResolvedValue(null);
      return texts.map(() => ({ model: "embedding", values: [1, 0] }));
    });
    await expect(test.run("org", "doc", "doc", "retry-user")).rejects.toThrow("document access denied");
    expect(test.completeProcessing).not.toHaveBeenCalled();
  });
});
