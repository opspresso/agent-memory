import type { DocumentRepository } from "@/domain/document/document-repository";
import { isDocumentTextMimeType } from "@/domain/document/document-format";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { KnowledgeExtractionService } from "@/domain/knowledge/knowledge-extraction-service";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";
import { canAccessScopedResource } from "@/domain/identity/organization-access";

export class KnowledgeCandidateSourceNotFoundError extends Error {
  constructor() {
    super("ready document chunk not found");
    this.name = "KnowledgeCandidateSourceNotFoundError";
  }
}

interface GenerateKnowledgeCandidateDependencies {
  readonly accessRepository: Pick<OrganizationAccessRepository, "findByUser">;
  readonly candidateRepository: Pick<KnowledgeCandidateRepository, "findByChunkId" | "save">;
  readonly clock: () => Date;
  readonly documentRepository: Pick<DocumentRepository, "findChunkById">;
  readonly extractionService: KnowledgeExtractionService;
  readonly generateId: () => string;
  readonly ontologyReader: KnowledgeOntologyReader;
}

export function buildGenerateKnowledgeCandidate(
  dependencies: GenerateKnowledgeCandidateDependencies
) {
  return async function execute(organizationId: string, chunkId: string, requestedBy?: string) {
    const existing = await dependencies.candidateRepository.findByChunkId(
      organizationId,
      chunkId
    );
    if (existing) {
      return existing;
    }
    const source = await dependencies.documentRepository.findChunkById(
      organizationId,
      chunkId
    );
    if (!source || source.document.status !== "ready") {
      throw new KnowledgeCandidateSourceNotFoundError();
    }
    const principalId = requestedBy ?? source.document.createdBy;
    const requiredAction = requestedBy === undefined ? "write" : "manage";
    const access = await dependencies.accessRepository.findByUser(organizationId, principalId);
    if (!access || !canAccessScopedResource(access, requiredAction, source.document.scope)) return null;
    const settings =
      await dependencies.ontologyReader.findByOrganization(organizationId);
    const ontologyHint =
      settings &&
      settings.mode !== "off" &&
      (settings.ontology.nodeKinds.length > 0 ||
        settings.ontology.edgePredicates.length > 0)
        ? {
            nodeKinds: settings.ontology.nodeKinds,
            edgePredicates: settings.ontology.edgePredicates,
            mode: settings.mode
          }
        : undefined;
    const extraction = await dependencies.extractionService.extract({
      content: source.chunk.content,
      documentTitle: source.document.title,
      mimeType: typeof source.chunk.metadata.textMimeType === "string" &&
        isDocumentTextMimeType(source.chunk.metadata.textMimeType)
        ? source.chunk.metadata.textMimeType : source.document.mimeType,
      source: { organizationId, chunkId: source.chunk.id },
      quotaKey: {
        organizationId,
        userId: access.userId
      },
      ...(ontologyHint ? { ontology: ontologyHint } : {})
    });
    // A queued request does not retain authority after its membership or source changes.
    const currentSource = await dependencies.documentRepository.findChunkById(organizationId, chunkId);
    const currentAccess = await dependencies.accessRepository.findByUser(organizationId, principalId);
    if (!currentSource || currentSource.document.status !== "ready" || !currentAccess ||
        !canAccessScopedResource(currentAccess, requiredAction, currentSource.document.scope)) return null;
    const candidate = createKnowledgeCandidate({
      id: dependencies.generateId(),
      scope: currentSource.document.scope,
      documentId: source.document.id,
      chunkId: source.chunk.id,
      model: extraction.model,
      graph: extraction.graph,
      now: dependencies.clock()
    });
    return dependencies.candidateRepository.save(candidate);
  };
}
