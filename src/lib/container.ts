import { createDatabase } from "@/infrastructure/database/client";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";

const defaultDatabaseUrl =
  "postgresql://agent_memory:agent_memory@localhost:5433/agent_memory";

export const database = createDatabase(
  process.env.DATABASE_URL ?? defaultDatabaseUrl
);

export const organizationAccessRepository =
  createOrganizationAccessRepository(database.db);

export const memoryRepository = createMemoryRepository(database.db);
export const documentRepository = createDocumentRepository(database.db);

const embeddingModel = process.env.EMBEDDING_MODEL?.trim();
export const textEmbeddingService = embeddingModel
  ? createTextEmbeddingService(embeddingModel)
  : undefined;
