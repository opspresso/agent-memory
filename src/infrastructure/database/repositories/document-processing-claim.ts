import { and, eq } from "drizzle-orm";
import type { DocumentProcessingClaim } from "@/domain/document/document-repository";
import { documents } from "../schema/documents";
import type { AgentMemoryDatabase } from "../client";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import { documentEmbeddingCheckpoints } from "../schema/document-embedding-checkpoints";
import { documentProcessingCheckpoints } from "../schema/document-processing-checkpoints";

export function documentProcessingClaimPredicate(claim: DocumentProcessingClaim) {
  return and(
    eq(documents.organizationId, claim.document.scope.organizationId),
    eq(documents.id, claim.document.id),
    eq(documents.processingGeneration, claim.document.processingGeneration),
    eq(documents.status, "processing"),
    eq(documents.processingLeaseId, claim.leaseId)
  );
}

/** Hold the source row through a checkpoint write so expired workers cannot repopulate it. */
export async function lockDocumentProcessingClaim(transaction: Pick<AgentMemoryDatabase, "select">, claim: DocumentProcessingClaim) {
  const [current] = await transaction.select({ id: documents.id }).from(documents)
    .where(documentProcessingClaimPredicate(claim)).for("share").limit(1);
  if (!current) throw new SafeOperationalError("document processing claim was lost", { code: "DOCUMENT_PROCESSING_CLAIM_LOST" });
}

export async function deleteDocumentProcessingCheckpoints(transaction: Pick<AgentMemoryDatabase, "delete">, organizationId: string, documentId: string) {
  await transaction.delete(documentEmbeddingCheckpoints).where(and(
    eq(documentEmbeddingCheckpoints.organizationId, organizationId), eq(documentEmbeddingCheckpoints.documentId, documentId)
  ));
  await transaction.delete(documentProcessingCheckpoints).where(and(
    eq(documentProcessingCheckpoints.organizationId, organizationId), eq(documentProcessingCheckpoints.documentId, documentId)
  ));
}
