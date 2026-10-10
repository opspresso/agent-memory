import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { maxDocumentChunkCharacters, maxDocumentChunks } from "@/domain/document/document";
import { documentTextMimeTypes } from "@/domain/document/document-format";
import type { DocumentProcessingCheckpointRepository } from "@/domain/document/document-processing-checkpoint";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import type { AgentMemoryDatabase } from "../client";
import { documentProcessingCheckpoints, documents } from "../schema";
import { documentProcessingClaimPredicate, lockDocumentProcessingClaim } from "./document-processing-claim";

const spanSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() });
const checkpointSchema = z.object({
  mimeType: z.enum(documentTextMimeTypes),
  parts: z.array(spanSchema.extend({ content: z.string().min(1).max(maxDocumentChunkCharacters),
    contextSpans: z.array(spanSchema).optional() })).min(1).max(maxDocumentChunks)
});

function validatedCheckpoint(value: unknown) {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success || parsed.data.parts.some((part) => part.end <= part.start ||
      part.contextSpans?.some((span) => span.end <= span.start))) {
    throw new SafeOperationalError("document processing checkpoint is invalid", { code: "DOCUMENT_PROCESSING_CHECKPOINT_INVALID" });
  }
  return parsed.data;
}

export function createDocumentProcessingCheckpointRepository(db: AgentMemoryDatabase): DocumentProcessingCheckpointRepository {
  return {
    async find(claim) {
      const [row] = await db.select({ mimeType: documentProcessingCheckpoints.mimeType, parts: documentProcessingCheckpoints.parts })
        .from(documentProcessingCheckpoints).innerJoin(documents, and(
          eq(documents.organizationId, documentProcessingCheckpoints.organizationId), eq(documents.id, documentProcessingCheckpoints.documentId)
        )).where(and(documentProcessingClaimPredicate(claim),
          eq(documentProcessingCheckpoints.generation, claim.document.processingGeneration))).limit(1);
      return row ? validatedCheckpoint(row) : null;
    },
    async save(claim, checkpoint) {
      const valid = validatedCheckpoint(checkpoint);
      await db.transaction(async (transaction) => {
        await lockDocumentProcessingClaim(transaction, claim);
        await transaction.insert(documentProcessingCheckpoints).values({
          organizationId: claim.document.scope.organizationId, documentId: claim.document.id,
          generation: claim.document.processingGeneration, ...valid
        }).onConflictDoNothing();
      });
    }
  };
}
