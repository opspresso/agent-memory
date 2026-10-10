import {
  createDocumentChunk,
  InvalidDocumentError,
  type DocumentChunk
} from "@/domain/document/document";
import type { DocumentProcessingClaim, DocumentRepository } from "@/domain/document/document-repository";
import { maxDocumentEmbeddingBatchSize, type DocumentEmbeddingCheckpointRepository } from "@/domain/document/document-embedding-checkpoint";
import type { DocumentProcessingCheckpoint, DocumentProcessingCheckpointRepository } from "@/domain/document/document-processing-checkpoint";
import type {
  DocumentObjectStorage,
  DocumentTextExtractor
} from "@/domain/document/document-services";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import { AiRequestLimitExceededError, type AiRequestQuotaKey } from "@/domain/shared/ai-request-limiter";
import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";
import { canAccessScopedResource, type OrganizationAccess } from "@/domain/identity/organization-access";
import { sameScope } from "@/domain/identity/scope-coverage";

import { chunkDocumentText } from "./chunk-text";
import { DocumentAccessDeniedError } from "./upload-document";

interface EmbeddingCheckpoints {
  readonly repository: DocumentEmbeddingCheckpointRepository;
  readonly fingerprint: (texts: readonly string[]) => string;
}

export interface ProcessDocumentDependencies {
  readonly accessRepository: Pick<OrganizationAccessRepository, "findByUser">;
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly embeddingCheckpoints?: EmbeddingCheckpoints;
  readonly processingCheckpoints?: DocumentProcessingCheckpointRepository;
  readonly generateId: () => string;
  readonly objectStorage: DocumentObjectStorage;
  readonly repository: Pick<DocumentRepository, "findById" | "claimForProcessing" | "completeProcessing" | "failProcessing" | "deferProcessing">;
  readonly textExtractor: DocumentTextExtractor;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof InvalidDocumentError
    ? error.message.slice(0, 2_000)
    : "document processing failed";
}

async function embedDocumentParts(
  embeddingService: TextEmbeddingService,
  texts: readonly string[],
  quotaKey: AiRequestQuotaKey,
  authorize: () => Promise<void>,
  checkpoints?: EmbeddingCheckpoints & { readonly claim: DocumentProcessingClaim }
) {
  const embeddings = [];
  for (let offset = 0; offset < texts.length; offset += maxDocumentEmbeddingBatchSize) {
    await authorize();
    const inputs = texts.slice(offset, offset + maxDocumentEmbeddingBatchSize);
    const key = checkpoints ? { claim: checkpoints.claim, fingerprint: checkpoints.fingerprint(inputs) } : undefined;
    const cached = checkpoints && key ? await checkpoints.repository.find(key) : null;
    const batch = cached ?? await embeddingService.embedMany(inputs, quotaKey);
    if (batch.length !== inputs.length) throw new Error("embedding result count does not match document chunks");
    if (!cached && checkpoints && key) {
      await authorize();
      await checkpoints.repository.save(key, batch);
    }
    embeddings.push(...batch);
  }
  return embeddings;
}

export function buildProcessDocument(dependencies: ProcessDocumentDependencies) {
  return async function execute(
    organizationId: string,
    documentId: string,
    generation: string,
    requestedBy: string,
    principalKind?: OrganizationAccess["principalKind"]
  ): Promise<void> {
    const startedAt = dependencies.clock();
    const claim = await dependencies.repository.claimForProcessing(organizationId, documentId, startedAt, generation);
    if (!claim) {
      return;
    }
    const { document } = claim;
    async function authorize() {
      const [current, access] = await Promise.all([
        dependencies.repository.findById(organizationId, documentId),
        dependencies.accessRepository.findByUser(organizationId, requestedBy)
      ]);
      if (!current || current.status !== "processing" || current.processingGeneration !== generation ||
          current.processingAttempts !== document.processingAttempts || !sameScope(current.scope, document.scope)) {
        throw new Error("document processing claim was lost");
      }
      if (!access || !canAccessScopedResource({ ...access, principalKind }, "write", current.scope)) throw new DocumentAccessDeniedError();
    }

    try {
      await authorize();
      let checkpoint: DocumentProcessingCheckpoint | null = await dependencies.processingCheckpoints?.find(claim) ?? null;
      if (!checkpoint) {
        const content = await dependencies.objectStorage.get(document.objectKey);
        const extracted = await dependencies.textExtractor.extract(content, document.mimeType);
        const parts = chunkDocumentText(extracted.text, extracted.mimeType);
        if (parts.length === 0) throw new InvalidDocumentError("document contains no extractable text");
        checkpoint = { mimeType: extracted.mimeType, parts };
        if (dependencies.processingCheckpoints) {
          await authorize();
          await dependencies.processingCheckpoints.save(claim, checkpoint);
        }
      }
      const { parts, mimeType } = checkpoint;
      const embeddings = dependencies.embeddingService
        ? await embedDocumentParts(
            dependencies.embeddingService,
            parts.map((part) => part.content),
            {
              organizationId,
              userId: requestedBy
            },
            authorize,
            dependencies.embeddingCheckpoints ? { ...dependencies.embeddingCheckpoints, claim } : undefined
          )
        : [];
      const firstEmbedding = embeddings[0];
      if (firstEmbedding && embeddings.some((embedding) => embedding.model !== firstEmbedding.model ||
          embedding.values.length !== firstEmbedding.values.length)) {
        throw new InvalidDocumentError("embedding model or dimensions changed during document processing; retry the document");
      }
      await authorize();
      const completedAt = dependencies.clock();
      const chunks: DocumentChunk[] = parts.map((part, ordinal) =>
        createDocumentChunk({
          id: dependencies.generateId(),
          organizationId,
          documentId,
          ordinal,
          content: part.content,
          ...(embeddings[ordinal]
            ? { embedding: embeddings[ordinal] }
            : {}),
          metadata: { textMimeType: mimeType, start: part.start, end: part.end, ...(part.contextSpans ? { contextSpans: part.contextSpans } : {}) },
          now: completedAt
        })
      );
      await dependencies.repository.completeProcessing(
        claim,
        chunks,
        completedAt
      );
    } catch (error) {
      try {
        if (error instanceof AiRequestLimitExceededError) await dependencies.repository.deferProcessing(claim, dependencies.clock());
        else await dependencies.repository.failProcessing(claim, safeErrorMessage(error), dependencies.clock());
      } catch (statusError) {
        throw new AggregateError(
          [error, statusError],
          "document processing and status update both failed"
        );
      }
      throw error;
    }
  };
}
