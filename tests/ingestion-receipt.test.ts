import { describe, expect, it, vi } from "vitest";
import { buildCreateMemory } from "@/application/memory/create-memory";
import type { Memory } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";
import type { IngestionReceipt } from "@/domain/shared/ingestion-receipt";
import { ingestionFingerprint } from "@/lib/ingestion-fingerprint";
import { buildUploadDocument } from "@/application/document/upload-document";
import type { Document } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";

describe("ingestion replay", () => {
  it("keeps source bytes when COMMIT succeeded but its response was lost", async () => {
    let receipt: IngestionReceipt | null = null;
    let stored: Document | null = null;
    const remove = vi.fn(async () => {});
    const repository = {
      save: async (document: Document, _limits: unknown, value: IngestionReceipt) => {
        stored = document; receipt = value; throw new Error("COMMIT response lost");
      },
      findById: async () => stored
    } as unknown as DocumentRepository;
    const upload = buildUploadDocument({ clock: () => new Date("2026-09-09T00:00:00Z"), generateId: () => "document-1",
      checksum: () => "b".repeat(64), fingerprint: ingestionFingerprint, receipts: { find: async () => receipt }, repository,
      limits: { maximumOrganizationStorageBytes: 1000, maximumPendingDocuments: 10, maximumUserUploadsPerHour: 10 },
      objectStorage: { put: async () => {}, get: vi.fn(), delete: remove }, queue: { enqueue: async () => "queued" } });
    const document = await upload({ access: { organizationId: "org", userId: "user", role: "member", teams: [] },
      scope: { kind: "user", organizationId: "org", userId: "user" }, idempotencyKey: "upload",
      title: "Transcript", mimeType: "text/markdown", content: new TextEncoder().encode("Transcript") });
    expect(document.id).toBe("document-1"); expect(remove).not.toHaveBeenCalled();
  });
  it("fingerprints nested objects independently of key order while preserving array order", () => {
    expect(ingestionFingerprint({ a: { b: 1, c: 2 }, list: [1, 2] }))
      .toBe(ingestionFingerprint({ list: [1, 2], a: { c: 2, b: 1 } }));
    expect(ingestionFingerprint({ list: [1, 2] })).not.toBe(ingestionFingerprint({ list: [2, 1] }));
  });
  it("keeps the first creation time and refuses replay of an archived memory", async () => {
    let stored: Memory | null = null;
    let receipt: IngestionReceipt | null = null;
    const generateId = vi.fn(() => "memory-1");
    const save = vi.fn(async (memory: Memory, value?: IngestionReceipt) => { stored = memory; receipt = value ?? null; });
    const repository: MemoryRepository = { save, findById: async () => stored,
      listVersions: vi.fn(), saveRevision: vi.fn(), search: vi.fn() };
    let now = new Date("2026-09-09T00:00:00Z");
    const create = buildCreateMemory({ clock: () => now, generateId, repository,
      fingerprint: ingestionFingerprint, receipts: { find: async () => receipt } });
    const input = { access: { organizationId: "org", userId: "user", role: "member" as const, teams: [] },
      scope: { kind: "user" as const, organizationId: "org", userId: "user" }, kind: "fact" as const,
      title: "Fact", content: "Content", source: { type: "agent" as const }, idempotencyKey: "event" };
    const first = await create(input);
    now = new Date("2026-09-10T00:00:00Z");
    expect((await create(input)).createdAt).toEqual(first.createdAt);
    expect(generateId).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
    stored = { ...first, status: "archived" };
    await expect(create(input)).rejects.toThrow("memory access denied");
    expect(save).toHaveBeenCalledTimes(1);
  });
});
