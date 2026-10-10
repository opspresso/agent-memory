import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildProcessDocument } from "@/application/document/process-document";
import { createDocument, type Document, type DocumentChunk } from "@/domain/document/document";
import type { DocumentProcessingClaim } from "@/domain/document/document-repository";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import type { DocumentProcessingCheckpoint } from "@/domain/document/document-processing-checkpoint";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";
import { createAiRequestLimiter } from "@/infrastructure/ai/request-limiter";

describe("document embedding checkpoints", () => {
  it("finishes three distinct batches across 1 RPM quota deferrals without repeating completed calls", async () => {
    let time = 0;
    let document: Document = createDocument({ id: "doc", scope: { organizationId: "org", kind: "organization" },
      title: "Source", objectKey: "source", checksum: "a".repeat(64), mimeType: "text/plain",
      sizeBytes: 260_130, createdBy: "user", now: new Date(time) });
    const content = Array.from({ length: 130 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(1996)}`).join("\n");
    const checkpoints = new Map<string, readonly MemoryEmbedding[]>();
    const calls: string[][] = [];
    let converted: DocumentProcessingCheckpoint | null = null;
    let chunks: readonly DocumentChunk[] = [];
    const limiter = createAiRequestLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 1, clock: () => time });
    const extract = vi.fn(async () => ({ text: content, mimeType: "text/plain" as const }));
    const dependencies = {
      clock: () => new Date(time), generateId: () => crypto.randomUUID(),
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ organizationId: "org", userId: "user", role: "owner", teams: [] }) },
      objectStorage: { get: async () => new TextEncoder().encode(content), put: vi.fn(), delete: vi.fn() },
      textExtractor: { extract },
      processingCheckpoints: { find: async () => converted,
        save: async (_claim: DocumentProcessingClaim, value: DocumentProcessingCheckpoint) => { converted = value; } },
      embeddingService: { embed: vi.fn(), embedMany: (texts: readonly string[]) => limiter.run(async () => {
        calls.push([...texts]);
        return texts.map(() => ({ model: "test", values: [1, 0] }));
      }) },
      embeddingCheckpoints: {
        fingerprint: (texts: readonly string[]) => createHash("sha256").update(JSON.stringify(texts)).digest("hex"),
        repository: {
          find: async (key: { claim: DocumentProcessingClaim; fingerprint: string }) => checkpoints.get(key.fingerprint) ?? null,
          save: async (key: { claim: DocumentProcessingClaim; fingerprint: string }, values: readonly MemoryEmbedding[]) => { checkpoints.set(key.fingerprint, values); }
        }
      },
      repository: {
        findById: async () => document,
        claimForProcessing: async () => {
          document = { ...document, status: "processing", processingAttempts: document.processingAttempts + 1 };
          return { document, leaseId: `lease-${document.processingAttempts}` };
        },
        completeProcessing: async (_claim: DocumentProcessingClaim, complete: readonly DocumentChunk[]) => { chunks = complete; document = { ...document, status: "ready" }; },
        failProcessing: async () => { document = { ...document, status: "failed" }; return true; },
        deferProcessing: async () => { document = { ...document, status: "pending" }; return true; }
      }
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(buildProcessDocument(dependencies)("org", "doc", "doc", "user")).rejects.toBeInstanceOf(AiRequestLimitExceededError);
      expect(chunks).toEqual([]);
      expect(document.status).toBe("pending");
      expect(checkpoints.size).toBe(attempt + 1);
      time += 60_000;
    }
    await buildProcessDocument(dependencies)("org", "doc", "doc", "user");
    expect(document.status).toBe("ready");
    expect(chunks).toHaveLength(130);
    expect(calls.map((batch) => batch.length)).toEqual([64, 64, 2]);
    expect(new Set(calls.flat()).size).toBe(130);
    expect(extract).toHaveBeenCalledOnce();
  });
});
