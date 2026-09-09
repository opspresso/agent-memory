import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createOrganizationAgentTokenRepository } from "@/infrastructure/database/repositories/organization-agent-token-repository";
import { createOrganizationAdministrationRepository } from "@/infrastructure/database/repositories/organization-administration-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { createKnowledgeTermUsageRepository } from "@/infrastructure/database/repositories/knowledge-term-usage-repository";
import { createKnowledgeOntologySuggestionService } from "@/infrastructure/ai/knowledge-ontology-suggestion-service";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createIngestionReceiptRepository } from "@/infrastructure/database/repositories/ingestion-receipt-repository";
import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";
import { createTextRerankerService } from "@/infrastructure/ai/text-reranker-service";
import { createKnowledgeVerificationService } from "@/infrastructure/ai/knowledge-verification-service";
import { createKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-extraction-service";
import {
  createAiRequestLimiter,
  readAiRequestLimits
} from "@/infrastructure/ai/request-limiter";
import {
  createPostgresAiRequestLimiter,
  readDurableAiRequestLimits
} from "@/infrastructure/ai/postgres-request-limiter";
import { createPlainTextExtractor } from "@/infrastructure/document/plain-text-extractor";
import {
  createS3Client,
  createS3DocumentObjectStorage
} from "@/infrastructure/object-storage/s3-document-object-storage";
import { logger } from "@/infrastructure/observability/logger";
import { createPgBossDocumentIngestionQueue } from "@/infrastructure/queue/document-ingestion-queue";
import { createOrganizationAgentTokenSecret } from "@/infrastructure/security/organization-agent-token-secret";
import { createOrganizationAgentTokenUseCases } from "@/application/identity/manage-organization-agent-token";
import { database, defaultDatabaseUrl } from "./database";

export { database };
const localAiRequestLimiter = createAiRequestLimiter(readAiRequestLimits());
const durableAiRequestLimiter = createPostgresAiRequestLimiter(
  database.db,
  readDurableAiRequestLimits()
);
const aiRequestLimiter = {
  run<T>(
    operation: () => Promise<T>,
    quotaKey?: Parameters<typeof durableAiRequestLimiter.run>[1]
  ) {
    return localAiRequestLimiter.run(
      () => durableAiRequestLimiter.run(operation, quotaKey),
      quotaKey
    );
  }
};

export const organizationAccessRepository =
  createOrganizationAccessRepository(database.db);
export const organizationAgentTokenRepository =
  createOrganizationAgentTokenRepository(database.db);
const organizationAgentTokenSecret = createOrganizationAgentTokenSecret(
  () => process.env.BETTER_AUTH_SECRET ?? ""
);
export const organizationAgentTokenUseCases =
  createOrganizationAgentTokenUseCases({
    accessRepository: organizationAccessRepository,
    clock: () => new Date(),
    repository: organizationAgentTokenRepository,
    secret: organizationAgentTokenSecret
  });
export const organizationAdministrationRepository =
  createOrganizationAdministrationRepository(database.db);

export const memoryRepository = createMemoryRepository(database.db);
export const documentRepository = createDocumentRepository(database.db);
export const ingestionReceiptRepository = createIngestionReceiptRepository(database.db);
export const knowledgeGraphRepository = createKnowledgeGraphRepository(database.db);
export const knowledgeCandidateRepository =
  createKnowledgeCandidateRepository(database.db);
export const knowledgeOntologyReader = createKnowledgeOntologyReader(
  database.db
);
export const knowledgeTermUsageRepository = createKnowledgeTermUsageRepository(
  database.db
);

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
    model: embeddingModel,
    requestLimiter: aiRequestLimiter
  });
}
export const textEmbeddingService = createConfiguredTextEmbeddingService();

const rerankerModel = process.env.RERANKER_MODEL?.trim();
const rerankerBaseUrl = process.env.RERANKER_BASE_URL?.trim();
function createConfiguredTextRerankerService() {
  if (!rerankerModel && !rerankerBaseUrl) {
    return undefined;
  }
  if (!rerankerModel || !rerankerBaseUrl) {
    throw new Error(
      "RERANKER_BASE_URL and RERANKER_MODEL must be set together"
    );
  }
  const configuredTimeout = process.env.RERANKER_TIMEOUT_MS?.trim();
  return createTextRerankerService({
    apiKey: process.env.RERANKER_API_KEY,
    baseUrl: rerankerBaseUrl,
    model: rerankerModel,
    requestLimiter: aiRequestLimiter,
    ...(configuredTimeout
      ? { timeoutMilliseconds: Number(configuredTimeout) }
      : {})
  });
}
export const textRerankerService = createConfiguredTextRerankerService();

function configuredRerankerMinimumScore() {
  const raw = process.env.RERANKER_MIN_SCORE?.trim();
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("RERANKER_MIN_SCORE must be between 0 and 1");
  }
  return value;
}
export const rerankerMinimumScore = configuredRerankerMinimumScore();

const knowledgeExtractionModel = process.env.KNOWLEDGE_EXTRACTION_MODEL?.trim();
const knowledgeExtractionBaseUrl =
  process.env.KNOWLEDGE_EXTRACTION_BASE_URL?.trim();
function createConfiguredKnowledgeExtractionService() {
  if (!knowledgeExtractionModel) {
    return undefined;
  }
  if (!knowledgeExtractionBaseUrl) {
    throw new Error(
      "KNOWLEDGE_EXTRACTION_BASE_URL must be set when KNOWLEDGE_EXTRACTION_MODEL is enabled"
    );
  }
  return createKnowledgeExtractionService({
    apiKey: process.env.KNOWLEDGE_EXTRACTION_API_KEY,
    baseUrl: knowledgeExtractionBaseUrl,
    model: knowledgeExtractionModel,
    requestLimiter: aiRequestLimiter
  });
}
export const knowledgeExtractionService =
  createConfiguredKnowledgeExtractionService();

export const knowledgeVerificationService = knowledgeExtractionModel && knowledgeExtractionBaseUrl
  ? createKnowledgeVerificationService({
      apiKey: process.env.KNOWLEDGE_EXTRACTION_API_KEY,
      baseUrl: knowledgeExtractionBaseUrl,
      model: knowledgeExtractionModel,
      requestLimiter: aiRequestLimiter
    })
  : undefined;

function createConfiguredKnowledgeOntologySuggestionService() {
  if (!knowledgeExtractionModel || !knowledgeExtractionBaseUrl) {
    return undefined;
  }
  return createKnowledgeOntologySuggestionService({
    apiKey: process.env.KNOWLEDGE_EXTRACTION_API_KEY,
    baseUrl: knowledgeExtractionBaseUrl,
    model: knowledgeExtractionModel,
    requestLimiter: aiRequestLimiter
  });
}
export const knowledgeOntologySuggestionService =
  createConfiguredKnowledgeOntologySuggestionService();

const s3Client = createS3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9010",
  region: process.env.S3_REGION ?? "ap-northeast-2",
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
