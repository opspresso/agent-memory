import { createDatabase } from "@/infrastructure/database/client";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createOrganizationAdministrationRepository } from "@/infrastructure/database/repositories/organization-administration-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";
import { createPlainTextExtractor } from "@/infrastructure/document/plain-text-extractor";
import {
  createS3Client,
  createS3DocumentObjectStorage
} from "@/infrastructure/object-storage/s3-document-object-storage";
import { logger } from "@/infrastructure/observability/logger";
import { createPgBossDocumentIngestionQueue } from "@/infrastructure/queue/document-ingestion-queue";

const defaultDatabaseUrl =
  "postgresql://agent_memory:agent_memory@localhost:5433/agent_memory";

export const database = createDatabase(
  process.env.DATABASE_URL ?? defaultDatabaseUrl
);

export const organizationAccessRepository =
  createOrganizationAccessRepository(database.db);
export const organizationAdministrationRepository =
  createOrganizationAdministrationRepository(database.db);

export const memoryRepository = createMemoryRepository(database.db);
export const documentRepository = createDocumentRepository(database.db);
export const knowledgeGraphRepository = createKnowledgeGraphRepository(database.db);

const embeddingModel = process.env.EMBEDDING_MODEL?.trim();
const embeddingBaseUrl = process.env.EMBEDDING_BASE_URL?.trim();
function createConfiguredTextEmbeddingService() {
  if (!embeddingModel) {
    return undefined;
  }
  if (!embeddingBaseUrl) {
    throw new Error(
      "EMBEDDING_BASE_URL must be set when EMBEDDING_MODEL is enabled"
    );
  }
  return createTextEmbeddingService({
    apiKey: process.env.EMBEDDING_API_KEY,
    baseUrl: embeddingBaseUrl,
    model: embeddingModel
  });
}
export const textEmbeddingService = createConfiguredTextEmbeddingService();

const s3Client = createS3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9010",
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "agent_memory",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "agent_memory_dev",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false"
});

export const documentObjectStorage = createS3DocumentObjectStorage({
  bucket: process.env.S3_BUCKET ?? "agent-memory",
  client: s3Client
});
export const documentTextExtractor = createPlainTextExtractor();
export const documentIngestionQueue = createPgBossDocumentIngestionQueue(
  process.env.DATABASE_URL ?? defaultDatabaseUrl,
  (error) => logger.error({ err: error }, "pg-boss error")
);
