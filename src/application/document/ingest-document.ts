import type { DocumentRepository } from "@/domain/document/document-repository";
import type { DocumentKnowledgeEnrichmentQueue } from "@/domain/document/document-services";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

interface IngestDocumentDependencies {
  readonly processDocument: (organizationId: string, documentId: string, generation: string, requestedBy: string, principalKind?: OrganizationAccess["principalKind"]) => Promise<void>;
  readonly repository: Pick<DocumentRepository, "listChunksByDocument">;
  readonly enrichmentQueue?: DocumentKnowledgeEnrichmentQueue;
}

export function buildIngestDocument(dependencies: IngestDocumentDependencies) {
  return async function execute(organizationId: string, documentId: string, generation: string, requestedBy: string, principalKind?: OrganizationAccess["principalKind"]): Promise<void> {
    await dependencies.processDocument(organizationId, documentId, generation, requestedBy, principalKind);
    if (!dependencies.enrichmentQueue) {
      return;
    }
    const chunks = await dependencies.repository.listChunksByDocument(
      organizationId,
      documentId
    );
    for (const chunk of chunks) {
      await dependencies.enrichmentQueue.enqueueKnowledgeEnrichment(organizationId, chunk.id, { userId: requestedBy, action: "write", principalKind });
    }
  };
}
