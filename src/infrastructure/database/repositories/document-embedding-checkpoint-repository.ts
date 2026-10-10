import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { maxDocumentEmbeddingBatchSize, type DocumentEmbeddingCheckpointRepository } from "@/domain/document/document-embedding-checkpoint";
import { maximumEmbeddingDimensions } from "@/domain/shared/text-embedding-service";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import type { AgentMemoryDatabase } from "../client";
import { documentEmbeddingCheckpoints, documents } from "../schema";
import { documentProcessingClaimPredicate, lockDocumentProcessingClaim } from "./document-processing-claim";

const embeddingsSchema = z.array(z.object({
  model: z.string().trim().min(1),
  values: z.array(z.number()).min(1).max(maximumEmbeddingDimensions)
    .refine((values) => values.every((value) => Number.isFinite(Math.fround(value))) && values.some((value) => Math.fround(value) !== 0))
})).min(1).max(maxDocumentEmbeddingBatchSize);

function validatedEmbeddings(value: unknown) {
  const parsed = embeddingsSchema.safeParse(value);
  if (!parsed.success || parsed.data.some((embedding) => embedding.model !== parsed.data[0]!.model ||
      embedding.values.length !== parsed.data[0]!.values.length)) {
    throw new SafeOperationalError("document embedding checkpoint is invalid", { code: "DOCUMENT_EMBEDDING_CHECKPOINT_INVALID" });
  }
  return parsed.data;
}

export function createDocumentEmbeddingCheckpointRepository(db: AgentMemoryDatabase): DocumentEmbeddingCheckpointRepository {
  return {
    async find({ claim, fingerprint }) {
      const [row] = await db.select({ embeddings: documentEmbeddingCheckpoints.embeddings })
        .from(documentEmbeddingCheckpoints).innerJoin(documents, and(
          eq(documents.organizationId, documentEmbeddingCheckpoints.organizationId),
          eq(documents.id, documentEmbeddingCheckpoints.documentId)
        )).where(and(documentProcessingClaimPredicate(claim),
          eq(documentEmbeddingCheckpoints.generation, claim.document.processingGeneration),
          eq(documentEmbeddingCheckpoints.fingerprint, fingerprint))).limit(1);
      return row ? validatedEmbeddings(row.embeddings) : null;
    },
    async save({ claim, fingerprint }, embeddings) {
      const valid = validatedEmbeddings(embeddings);
      await db.transaction(async (transaction) => {
        await lockDocumentProcessingClaim(transaction, claim);
        await transaction.insert(documentEmbeddingCheckpoints).values({
          organizationId: claim.document.scope.organizationId, documentId: claim.document.id,
          generation: claim.document.processingGeneration, fingerprint, embeddings: valid
        }).onConflictDoNothing();
      });
    }
  };
}
