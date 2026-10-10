import { describe, expect, it, vi } from "vitest";

import {
  chunkDocumentText,
  chunkText
} from "@/application/document/chunk-text";
import { buildProcessDocument } from "@/application/document/process-document";
import {
  buildUploadDocument,
  DocumentQuotaExceededError
} from "@/application/document/upload-document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createDocument, InvalidDocumentError } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type {
  DocumentIngestionQueue,
  DocumentObjectStorage
} from "@/domain/document/document-services";
import {
  createPlainTextExtractor
} from "@/infrastructure/document/plain-text-extractor";

const now = new Date("2026-08-26T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};
const uploadLimits = {
  maximumOrganizationStorageBytes: 1_000_000,
  maximumPendingDocuments: 10,
  maximumUserUploadsPerHour: 10
} as const;

function repository(overrides: Partial<DocumentRepository> = {}): DocumentRepository {
  return {
    save: vi.fn().mockResolvedValue("saved"),
    findById: vi.fn(),
    findChunkById: vi.fn(),
    listChunksByDocument: vi.fn(),
    prepareRetry: vi.fn(),
    claimForProcessing: vi.fn(),
    completeProcessing: vi.fn(),
    failProcessing: vi.fn(), deferProcessing: vi.fn(),
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

function processingDocument(input: Parameters<typeof createDocument>[0]) {
  return { ...createDocument(input), status: "processing" as const, processingAttempts: 1 };
}

describe("document processing", () => {
  it("extracts supported UTF-8 text without reparsing JSON", async () => {
    const extractor = createPlainTextExtractor();

    await expect(
      extractor.extract(
        new TextEncoder().encode('{"rollback":true}'),
        "application/json; charset=utf-8"
      )
    ).resolves.toEqual({ text: '{"rollback":true}', mimeType: "application/json" });
    await expect(
      extractor.extract(new Uint8Array([0, 1, 2]), "application/pdf")
    ).rejects.toBeInstanceOf(InvalidDocumentError);
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

  it.each([0, 19, 20, 119])("keeps Unicode characters intact with %s characters of overlap", (overlapCharacters) => {
    const source = "a" + "😀".repeat(200);
    const chunks = chunkText(source, { maxCharacters: 120, overlapCharacters });
    const covered = new Set<number>();
    for (const chunk of chunks) {
      expect(Buffer.from(chunk.content).toString("utf8")).toBe(chunk.content);
      expect(chunk.content).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.content.length).toBeLessThanOrEqual(120);
      for (let index = chunk.start; index < chunk.end; index += 1) covered.add(index);
    }
    expect(covered.size).toBe(source.length);
  });

  it("prefers paragraph boundaries over spaces inside the next provision", () => {
    const paragraph = "First complete provision. ".repeat(4).trim();
    const source = `${paragraph}\n\nSecond provision has conditions and exceptions that belong together.\n\nLast provision.`;
    const chunks = chunkText(source, { maxCharacters: 150, overlapCharacters: 0 });
    expect(chunks[0]?.content).toBe(paragraph);
    expect(chunks[1]?.content).toContain("Second provision has conditions and exceptions that belong together.");
    expect(chunks.every((chunk) => chunk.content === source.slice(chunk.start, chunk.end))).toBe(true);
  });

  it("starts overlapping legal text at word boundaries without dropping source characters", () => {
    const source = Array.from({ length: 20 }, (_, index) =>
      `제${index + 1}조 대한민국헌법은 권리와 의무를 규정하며 조건과 예외를 함께 읽어야 한다.`).join("\n\n");
    const chunks = chunkText(source, { maxCharacters: 120, overlapCharacters: 20 });
    const covered = new Set<number>();
    for (const chunk of chunks) {
      expect(chunk.content).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.content.length).toBeLessThanOrEqual(120);
      if (chunk.start > 0) expect(source[chunk.start - 1]).toMatch(/\s/);
      for (let index = chunk.start; index < chunk.end; index += 1) covered.add(index);
    }
    expect([...source].every((character, index) => /\s/.test(character) || covered.has(index))).toBe(true);
  });

  it("omits overlap wholly inside a complete final word", () => {
    const paragraph = `${"prefix ".repeat(10)}${"long".repeat(10)}`;
    const following = "Following provision keeps its whole text.";
    const source = `${paragraph}\n\n${following}`;
    const chunks = chunkText(source, { maxCharacters: 120, overlapCharacters: 20 });
    expect(chunks.map((chunk) => chunk.content)).toEqual([paragraph, following]);
    expect(chunks.every((chunk) => chunk.content === source.slice(chunk.start, chunk.end))).toBe(true);
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

  it("chunks Markdown with a heading that exhausts the context budget", () => {
    for (const headingLength of [1_800, 1_900]) {
      const chunks = chunkDocumentText(
        `# ${"h".repeat(headingLength)}\n\n${"body ".repeat(400)}`,
        "text/markdown"
      );

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.length).toBeLessThanOrEqual(3);
      expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
    }
  });

  it("retains profile ownership and career scope without carrying sibling employers", () => {
    const source = "# 김하늘\n\n## 경력\n\n### 북극소프트\n\n2020–2022 엔지니어\n\n### 새벽연구소\n\n2023–현재 연구원";
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe("# 김하늘\n## 경력\n\n### 북극소프트\n\n2020–2022 엔지니어");
    expect(chunks[1]?.content).toBe("# 김하늘\n## 경력\n\n### 새벽연구소\n\n2023–현재 연구원");
    for (const chunk of chunks) {
      const context = chunk.contextSpans!.map(({ start, end }) => source.slice(start, end)).join("\n");
      expect(chunk.content).toBe(`${context}\n\n${source.slice(chunk.start, chunk.end)}`);
    }
  });

  it("packs consecutive heading-only siblings with their shared parent context", () => {
    const source = "# Handbook\n\n## References\n\n### First reference\n\n### Second reference\n\n### Third reference";
    const chunks = chunkDocumentText(source, "text/markdown");

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0]!;
    const context = chunk.contextSpans!.map(({ start, end }) => source.slice(start, end)).join("\n");
    expect(context).toBe("# Handbook\n## References");
    expect(chunk.content).toBe(`${context}\n\n${source.slice(chunk.start, chunk.end)}`);
    expect(chunk.content).toContain("### First reference\n\n### Second reference\n\n### Third reference");
  });

  it("ends a heading-only group before a body or a different parent", () => {
    const source = "# Handbook\n\n## References\n\n### First\n\n### Second\n\n### Third\n\nThird has its own body.\n\n## Other\n\n### Fourth\n\n### Fifth\n\n# Another owner";
    const chunks = chunkDocumentText(source, "text/markdown");

    expect(chunks).toHaveLength(4);
    expect(chunks[0]?.content).toBe("# Handbook\n## References\n\n### First\n\n### Second");
    expect(chunks[1]?.content).toBe("# Handbook\n## References\n\n### Third\n\nThird has its own body.");
    expect(chunks[2]?.content).toBe("# Handbook\n## Other\n\n### Fourth\n\n### Fifth");
    expect(chunks[3]?.content).toBe("# Another owner");
    expect(chunkDocumentText("# First owner\n\n# Second owner", "text/markdown"))
      .toHaveLength(2);
  });

  it("bounds long heading-only groups without promoting a sibling to parent context", () => {
    const source = `# Handbook\n\n## References\n\n${Array.from({ length: 100 }, (_, index) => `### Reference ${index} ${"detail ".repeat(8)}`).join("\n\n")}`;
    const chunks = chunkDocumentText(source, "text/markdown");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(10);
    for (const chunk of chunks) {
      const context = chunk.contextSpans!.map(({ start, end }) => source.slice(start, end)).join("\n");
      expect(context).toBe("# Handbook\n## References");
      expect(chunk.content).toBe(`${context}\n\n${source.slice(chunk.start, chunk.end)}`);
      expect(chunk.content.length).toBeLessThanOrEqual(2_000);
    }
    for (let index = 0; index < 100; index += 1) {
      expect(chunks.some((chunk) => chunk.content.includes(`### Reference ${index} `))).toBe(true);
    }
  });

  it("resets heading ownership for another profile and ignores headings in fenced examples", () => {
    const source = "# 김하늘\n\n## 기술\n\n```md\n# 다른 사람\n```\n\nTypeScript\n\n# 박서준\n\n## 경력\n\n### 달빛회사\n\n엔지니어";
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContain("```md\n# 다른 사람\n```");
    expect(chunks[1]?.content).toBe("# 박서준\n## 경력\n\n### 달빛회사\n\n엔지니어");
  });

  it("preserves hierarchy on long sections with bounded chunks and exact source spans", () => {
    const source = `# 김하늘\n\n## 프로젝트\n\n  ### 별빛도구\n\n${"작업 내용과 기술 근거입니다. ".repeat(400)}`;
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.content).toContain("# 김하늘\n## 프로젝트");
      expect(chunk.content).toContain("### 별빛도구");
      expect(chunk.content.length).toBeLessThanOrEqual(2_000);
      const context = chunk.contextSpans!.map(({ start, end }) => source.slice(start, end)).join("\n");
      expect(chunk.content).toBe(`${context}\n\n${source.slice(chunk.start, chunk.end)}`);
    }
    expect(chunkDocumentText("# 단일 제목", "text/markdown")[0]?.content).toBe("# 단일 제목");
  });
  it("does not let backticks inside an invalid fence opener hide following headings", () => {
    const source = "# 김하늘\n\n## 기술\n\n```inline code```\nTypeScript\n\n## 경력\n\n북극소프트에서 근무했다.";
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.content).toBe("# 김하늘\n\n## 경력\n\n북극소프트에서 근무했다.");
  });

  it.each(["\n", "\r\n"])("preserves CSV source spans across blank records and %j line endings", (newline) => {
    const header = "name,notes";
    const first = `Alice,"${"a".repeat(1000)}\ncontinued"`;
    const second = `Bob,${"b".repeat(1000)}`;
    const normalized = `${header}\n\n${first}\n\n${second}`;
    const chunks = chunkDocumentText(normalized.replaceAll("\n", newline), "text/csv");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ content: `${header}\n${first}`, start: 0, end: normalized.indexOf(first) + first.length });
    expect(chunks[1]).toMatchObject({
      content: `${header}\n${second}`,
      start: normalized.indexOf(second), end: normalized.length,
      contextSpans: [{ start: 0, end: header.length }]
    });
    expect(normalized.slice(chunks[1]!.start, chunks[1]!.end)).toBe(second);
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

  it("bounds CSV chunks when one record exceeds the context budget", () => {
    const chunks = chunkDocumentText(
      `name,description\nAgent Memory,${"context ".repeat(400)}`,
      "text/csv"
    );

    expect(chunks.length).toBeGreaterThan(1);
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

  it("flattens deeply nested JSON without recursive stack growth", () => {
    const depth = 20_000;
    const chunks = chunkDocumentText(
      `${'{"value":'.repeat(depth)}0${"}".repeat(depth)}`,
      "application/json"
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
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

  it("updates XML ancestor paths as sequential elements change", () => {
    const chunks = chunkDocumentText(
      `<root><first>${"first value ".repeat(220)}</first><second>${"second value ".repeat(220)}</second></root>`,
      "application/xml"
    );

    expect(
      chunks.some((chunk) =>
        chunk.content.startsWith("XML context: /root/second")
      )
    ).toBe(true);
  });

  it("omits oversized XML context instead of exceeding the chunk limit", () => {
    const element = "nested".repeat(80);
    const chunks = chunkDocumentText(
      `<${element}><${element}><value>${"context ".repeat(400)}</value></${element}></${element}>`,
      "application/xml"
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
    expect(
      chunks.every((chunk) => !chunk.content.startsWith("XML context:"))
    ).toBe(true);
  });

  it("stores source bytes before persisting and enqueuing metadata", async () => {
    const storage = objectStorage();
    const save = vi.fn<DocumentRepository["save"]>().mockResolvedValue("saved");
    const queue: DocumentIngestionQueue = { enqueue: vi.fn() };
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      limits: uploadLimits,
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
      limits: uploadLimits,
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
      limits: uploadLimits,
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

  it("removes the source object when a durable upload quota is exceeded", async () => {
    const storage = objectStorage();
    const enqueue = vi.fn();
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      limits: uploadLimits,
      objectStorage: storage,
      queue: { enqueue },
      repository: repository({
        save: vi.fn().mockResolvedValue("organization_storage_exceeded")
      })
    });

    await expect(
      upload({
        access,
        scope: {
          kind: "user",
          organizationId: "organization-1",
          userId: "user-1"
        },
        title: "Runbook",
        mimeType: "text/plain",
        content: new TextEncoder().encode("Rollback safely")
      })
    ).rejects.toMatchObject({
      name: DocumentQuotaExceededError.name,
      reason: "organization_storage_exceeded"
    });
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
      limits: uploadLimits,
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
      limits: uploadLimits,
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
      now,
      "document-1"
    );
  });

  it("preserves enqueue and failure-status errors together", async () => {
    const enqueueFailure = new Error("queue unavailable");
    const statusFailure = new Error("database unavailable");
    const upload = buildUploadDocument({
      checksum: () => "a".repeat(64),
      clock: () => now,
      generateId: () => "document-1",
      limits: uploadLimits,
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
    const document = processingDocument({
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
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ ...access, role: "owner" }) },
      clock: () => now,
      generateId: () => "chunk-1",
      objectStorage: objectStorage({
        get: vi.fn().mockResolvedValue(new TextEncoder().encode("Rollback safely"))
      }),
      repository: repository({
        findById: vi.fn().mockResolvedValue(document),
        claimForProcessing: vi.fn().mockResolvedValue({
          document,
          leaseId: "lease-1"
        }),
        completeProcessing
      }),
      textExtractor: {
        extract: vi.fn().mockResolvedValue({ text: "Rollback safely", mimeType: "text/plain" })
      },
      embeddingService: {
        embed: vi.fn(),
        embedMany: vi
          .fn()
          .mockResolvedValue([{ model: "embedding-model", values: [1, 0] }])
      }
    });

    await process("organization-1", "document-1", "document-1", "user-1");

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

  it("bounds embedding request batches for large documents", async () => {
    const document = processingDocument({
      id: "document-1",
      scope: { kind: "organization", organizationId: "organization-1" },
      title: "Large handbook",
      objectKey: "objects/document-1",
      checksum: "a".repeat(64),
      mimeType: "text/plain",
      sizeBytes: 300_000,
      createdBy: "user-1",
      now
    });
    const completeProcessing = vi.fn<DocumentRepository["completeProcessing"]>();
    const embedMany = vi.fn(async (texts: readonly string[]) =>
      texts.map(() => ({ model: "embedding-model", values: [1, 0] }))
    );
    let nextChunkId = 0;
    const process = buildProcessDocument({
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ ...access, role: "owner" }) },
      clock: () => now,
      embeddingService: { embed: vi.fn(), embedMany },
      generateId: () => `chunk-${nextChunkId++}`,
      objectStorage: objectStorage({
        get: vi.fn().mockResolvedValue(new TextEncoder().encode("content"))
      }),
      repository: repository({
        findById: vi.fn().mockResolvedValue(document),
        claimForProcessing: vi.fn().mockResolvedValue({
          document,
          leaseId: "lease-1"
        }),
        completeProcessing
      }),
      textExtractor: {
        extract: vi
          .fn()
          .mockResolvedValue(
            { text: Array.from({ length: 130 }, () => "x".repeat(2_000)).join("\n"), mimeType: "text/plain" }
          )
      }
    });

    await process("organization-1", "document-1", "document-1", "user-1");

    expect(embedMany.mock.calls.length).toBeGreaterThan(1);
    expect(
      Math.max(...embedMany.mock.calls.map(([texts]) => texts.length))
    ).toBe(64);
    const embeddedCount = embedMany.mock.calls.reduce(
      (total, [texts]) => total + texts.length,
      0
    );
    expect(completeProcessing.mock.calls[0]?.[1]).toHaveLength(embeddedCount);
  });

  it("processes Markdown with more than 512 short headings within the chunk budget", async () => {
    const source = Array.from({ length: 40 }, (_, index) =>
      `# Owner ${index}\n\n## References\n\n${Array.from({ length: 16 }, (_, reference) => `### Reference ${index}-${reference}`).join("\n\n")}`
    ).join("\n\n");
    const document = processingDocument({
      id: "document-1",
      scope: { kind: "organization", organizationId: "organization-1" },
      title: "Heading-dense handbook",
      objectKey: "objects/document-1",
      checksum: "a".repeat(64),
      mimeType: "text/markdown",
      sizeBytes: new TextEncoder().encode(source).byteLength,
      createdBy: "user-1",
      now
    });
    const completeProcessing = vi.fn<DocumentRepository["completeProcessing"]>();
    const failProcessing = vi.fn<DocumentRepository["failProcessing"]>();
    const embedMany = vi.fn(async (texts: readonly string[]) =>
      texts.map(() => ({ model: "embedding-model", values: [1, 0] }))
    );
    let nextChunkId = 0;
    const process = buildProcessDocument({
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ ...access, role: "owner" }) },
      clock: () => now,
      generateId: () => `chunk-${nextChunkId++}`,
      objectStorage: objectStorage({ get: vi.fn().mockResolvedValue(new TextEncoder().encode(source)) }),
      repository: repository({
        findById: vi.fn().mockResolvedValue(document),
        claimForProcessing: vi.fn().mockResolvedValue({ document, leaseId: "lease-1" }),
        completeProcessing,
        failProcessing
      }),
      textExtractor: createPlainTextExtractor(),
      embeddingService: { embed: vi.fn(), embedMany }
    });

    await process("organization-1", "document-1", "document-1", "user-1");

    const chunks = completeProcessing.mock.calls[0]![1];
    expect(chunks).toHaveLength(40);
    expect(embedMany).toHaveBeenCalledOnce();
    expect(failProcessing).not.toHaveBeenCalled();
    for (let index = 0; index < 40; index += 1) {
      expect(chunks[index]?.content).toContain(`# Owner ${index}\n## References`);
      expect(chunks[index]?.content).toContain(`### Reference ${index}-15`);
      expect(chunks[index]?.embedding).toEqual({ model: "embedding-model", values: [1, 0] });
    }
  });

  it("records a bounded failure when extraction fails", async () => {
    const document = processingDocument({
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
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ ...access, role: "owner" }) },
      clock: () => now,
      generateId: () => "chunk-1",
      objectStorage: objectStorage({
        get: vi.fn().mockResolvedValue(new TextEncoder().encode("content"))
      }),
      repository: repository({
        findById: vi.fn().mockResolvedValue(document),
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

    await expect(process("organization-1", "document-1", "document-1", "user-1")).rejects.toThrow(
      "extractor failed"
    );
    expect(failProcessing).toHaveBeenCalledWith(
      { document, leaseId: "lease-1" },
      "document processing failed",
      now
    );
  });

  it("rejects documents that exceed the processing lease chunk budget", async () => {
    const document = processingDocument({
      id: "document-1",
      scope: { kind: "organization", organizationId: "organization-1" },
      title: "Oversized handbook",
      objectKey: "objects/document-1",
      checksum: "a".repeat(64),
      mimeType: "text/plain",
      sizeBytes: 1_100_000,
      createdBy: "user-1",
      now
    });
    const embedMany = vi.fn();
    const failProcessing = vi.fn<DocumentRepository["failProcessing"]>();
    const process = buildProcessDocument({
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ ...access, role: "owner" }) },
      clock: () => now,
      embeddingService: { embed: vi.fn(), embedMany },
      generateId: () => "chunk-1",
      objectStorage: objectStorage({
        get: vi.fn().mockResolvedValue(new TextEncoder().encode("content"))
      }),
      repository: repository({
        findById: vi.fn().mockResolvedValue(document),
        claimForProcessing: vi.fn().mockResolvedValue({
          document,
          leaseId: "lease-1"
        }),
        failProcessing
      }),
      textExtractor: {
        extract: vi
          .fn()
          .mockResolvedValue(
            { text: Array.from({ length: 513 }, () => "x".repeat(2_000)).join("\n"), mimeType: "text/plain" }
          )
      }
    });

    await expect(process("organization-1", "document-1", "document-1", "user-1")).rejects.toThrow(
      "document exceeds the 512 chunk processing limit"
    );
    expect(embedMany).not.toHaveBeenCalled();
    expect(failProcessing).toHaveBeenCalledWith(
      { document, leaseId: "lease-1" },
      "document exceeds the 512 chunk processing limit",
      now
    );
  });

  it("treats an already processed job as an idempotent success", async () => {
    const storage = objectStorage();
    const process = buildProcessDocument({
      accessRepository: { findByUser: vi.fn().mockResolvedValue({ ...access, role: "owner" }) },
      clock: () => now,
      generateId: () => "chunk-1",
      objectStorage: storage,
      repository: repository({
        claimForProcessing: vi.fn().mockResolvedValue(null)
      }),
      textExtractor: { extract: vi.fn() }
    });

    await expect(
      process("organization-1", "document-1", "document-1", "user-1")
    ).resolves.toBeUndefined();
    expect(storage.get).not.toHaveBeenCalled();
  });
});
