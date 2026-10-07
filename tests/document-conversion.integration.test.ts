import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildUploadDocument } from "@/application/document/upload-document";
import { buildProcessDocument } from "@/application/document/process-document";
import { buildSearchDocuments } from "@/application/document/search-documents";
import type { DocumentObjectStorage } from "@/domain/document/document-services";
import { documentFormats } from "@/domain/document/document-format";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { users, organizations, organizationMembers } from "@/infrastructure/database/schema";
import { createMarkItDownTextExtractor } from "@/infrastructure/document/markitdown-text-extractor";
import { createPgBossDocumentIngestionQueue, documentIngestionQueueName, type DocumentIngestionJob } from "@/infrastructure/queue/document-ingestion-queue";

describe("binary document ingestion and retrieval", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let repository: ReturnType<typeof createDocumentRepository>;
  let queue: ReturnType<typeof createPgBossDocumentIngestionQueue>;
  const objects = new Map<string, Uint8Array>();
  const errors: unknown[] = [];
  const objectStorage: DocumentObjectStorage = {
    async put(key, content) { objects.set(key, content.slice()); },
    async get(key) { const content = objects.get(key); if (!content) throw new Error("missing object"); return content; },
    async delete(key) { objects.delete(key); }
  };
  const organizationId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID();
  const access: OrganizationAccess = { organizationId, userId, role: "member", teams: [] };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
    await database.db.insert(users).values([userId, otherUserId].map((id) => ({ id, name: "Parser test", email: `${id}@example.com`, emailVerified: true })));
    await database.db.insert(organizations).values({ id: organizationId, slug: organizationId, name: "Parser test" });
    await database.db.insert(organizationMembers).values([userId, otherUserId].map((id) => ({ organizationId, userId: id, role: "member" as const, status: "active" as const })));
    repository = createDocumentRepository(database.db);
    queue = createPgBossDocumentIngestionQueue(container.getConnectionUri(), (error) => errors.push(error));
    const processDocument = buildProcessDocument({ repository, objectStorage, clock: () => new Date(), generateId: randomUUID,
      textExtractor: createMarkItDownTextExtractor({ pythonPath: process.env.DOCUMENT_PARSER_PYTHON ?? resolve(".venv-document-parser/bin/python") }) });
    const boss = await queue.start();
    await boss.work<DocumentIngestionJob>(documentIngestionQueueName, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async (jobs) => {
      for (const job of jobs) await processDocument(job.data.organizationId, job.data.documentId, job.data.expectedAttempts);
    });
  });
  afterAll(async () => {
    await queue?.stop();
    await database?.close();
    await container?.stop();
  });

  it.each(Object.entries(documentFormats).filter(([mimeType, format]) => mimeType !== format.textMimeType))(
    "queues, converts and searches %s within the original access scope", async (mimeType, format) => {
      const content = await readFile(resolve("tests/fixtures/documents", `sample${format.extensions[0]}`));
      const upload = buildUploadDocument({ repository, objectStorage, queue, clock: () => new Date(), generateId: randomUUID,
        checksum: (bytes) => createHash("sha256").update(bytes).digest("hex"),
        limits: { maximumOrganizationStorageBytes: 1_000_000, maximumPendingDocuments: 20, maximumUserUploadsPerHour: 100 } });
      const document = await upload({ access, scope: { organizationId, userId, kind: "user" }, title: "Format fixture", mimeType, content });
      expect(document.status).toBe("pending");
      await expect.poll(async () => (await repository.findById(organizationId, document.id))?.status,
        { timeout: 15_000, interval: 100 }).toBe("ready");
      expect(Buffer.from(await objectStorage.get(document.objectKey))).toEqual(content);
      const search = buildSearchDocuments({ repository });
      const matches = (await search(access, "Orion", 100)).filter((hit) => hit.document.id === document.id);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.document).toMatchObject({ mimeType, checksum: document.checksum, status: "ready" });
      expect(matches[0]?.chunk.metadata).toMatchObject({ textMimeType: "text/markdown" });
      expect(await search({ ...access, userId: otherUserId }, "Orion", 100)).toEqual([]);
      expect(await repository.findById(randomUUID(), document.id)).toBeNull();
      expect(errors).toEqual([]);
    });
});
