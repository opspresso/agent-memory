import type { DocumentRepository } from "@/domain/document/document-repository";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { KnowledgeExtractionService } from "@/domain/knowledge/knowledge-extraction-service";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";

export class KnowledgeCandidateSourceNotFoundError extends Error {
  constructor() {
    super("ready document chunk not found");
    this.name = "KnowledgeCandidateSourceNotFoundError";
  }
}

interface GenerateKnowledgeCandidateDependencies {
  readonly candidateRepository: KnowledgeCandidateRepository;
  readonly clock: () => Date;
  readonly documentRepository: DocumentRepository;
  readonly extractionService: KnowledgeExtractionService;
  readonly generateId: () => string;
  readonly ontologyReader: KnowledgeOntologyReader;
}

export function buildGenerateKnowledgeCandidate(
  dependencies: GenerateKnowledgeCandidateDependencies
) {
  return async function execute(organizationId: string, chunkId: string) {
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
      mimeType: source.document.mimeType,
      ...(ontologyHint ? { ontology: ontologyHint } : {})
    });
    const candidate = createKnowledgeCandidate({
      id: dependencies.generateId(),
      scope: source.document.scope,
      documentId: source.document.id,
      chunkId: source.chunk.id,
      model: extraction.model,
      graph: extraction.graph,
      now: dependencies.clock()
    });
    return dependencies.candidateRepository.save(candidate);
  };
}
