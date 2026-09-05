import type { DocumentRepository } from "@/domain/document/document-repository";
import type { DocumentKnowledgeEnrichmentQueue } from "@/domain/document/document-services";

interface IngestDocumentDependencies {
  readonly processDocument: (organizationId: string, documentId: string) => Promise<void>;
  readonly repository: Pick<DocumentRepository, "listChunksByDocument">;
  readonly enrichmentQueue?: DocumentKnowledgeEnrichmentQueue;
}

export function buildIngestDocument(dependencies: IngestDocumentDependencies) {
  return async function execute(organizationId: string, documentId: string): Promise<void> {
    await dependencies.processDocument(organizationId, documentId);
    if (!dependencies.enrichmentQueue) {
      return;
    }
    const chunks = await dependencies.repository.listChunksByDocument(
      organizationId,
      documentId
    );
    for (const chunk of chunks) {
      await dependencies.enrichmentQueue.enqueueKnowledgeEnrichment(organizationId, chunk.id);
    }
  };
}
