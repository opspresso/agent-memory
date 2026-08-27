import type { DocumentRepository } from "@/domain/document/document-repository";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { KnowledgeExtractionService } from "@/domain/knowledge/knowledge-extraction-service";

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
    const extraction = await dependencies.extractionService.extract({
      content: source.chunk.content,
      documentTitle: source.document.title,
      mimeType: source.document.mimeType
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

export function buildGenerateDocumentKnowledgeCandidates(
  dependencies: GenerateKnowledgeCandidateDependencies
) {
  const generateCandidate = buildGenerateKnowledgeCandidate(dependencies);
  return async function execute(organizationId: string, documentId: string) {
    const document = await dependencies.documentRepository.findById(
      organizationId,
      documentId
    );
    if (!document || document.status !== "ready") {
      throw new KnowledgeCandidateSourceNotFoundError();
    }
    const chunks = await dependencies.documentRepository.listChunksByDocument(
      organizationId,
      documentId
    );
    const candidates = [];
    for (const chunk of chunks) {
      candidates.push(await generateCandidate(organizationId, chunk.id));
    }
    return candidates;
  };
}
