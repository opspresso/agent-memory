import type { DocumentSearchHit } from "@/domain/document/document-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { KnowledgeNodeSearchHit } from "@/domain/knowledge/knowledge-graph-repository";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import type { MemorySearchHit } from "@/domain/memory/memory-repository";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import type { AiRequestQuotaKey } from "@/domain/shared/ai-request-limiter";
import {
  TextRerankerUnavailableError,
  type TextRerankerService
} from "@/domain/shared/text-reranker-service";

interface ContextSearchScore {
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly candidateScore: number;
  readonly rerankScore?: number;
  readonly score: number;
}

export type ContextSearchHit =
  | (ContextSearchScore &
      Readonly<{ sourceType: "memory"; memory: MemorySearchHit["memory"] }>)
  | (ContextSearchScore &
      Readonly<{
        sourceType: "document";
        document: DocumentSearchHit["document"];
        chunk: DocumentSearchHit["chunk"];
      }>)
  | (ContextSearchScore &
      Readonly<{
        sourceType: "knowledge";
        node: KnowledgeNodeSearchHit["node"];
      }>);

export interface ContextSearchResult {
  readonly hits: readonly ContextSearchHit[];
  readonly counts: Readonly<{
    memories: number;
    documents: number;
    knowledge: number;
  }>;
  readonly ranking: "hybrid" | "rerank";
}

export interface ContextSearchDependencies {
  readonly searchMemories: (
    access: OrganizationAccess,
    query: string,
    limit: number,
    queryEmbedding?: MemoryEmbedding
  ) => Promise<readonly MemorySearchHit[]>;
  readonly searchDocuments: (
    access: OrganizationAccess,
    query: string,
    limit: number,
    queryEmbedding?: MemoryEmbedding
  ) => Promise<readonly DocumentSearchHit[]>;
  readonly searchKnowledge: (
    access: OrganizationAccess,
    query: string,
    limit: number,
    queryEmbedding?: MemoryEmbedding
  ) => Promise<readonly KnowledgeNodeSearchHit[]>;
  readonly embeddingService?: TextEmbeddingService;
  readonly rerankerService?: TextRerankerService;
  readonly minimumRerankScore?: number;
  readonly onRerankerUnavailable?: (
    error: TextRerankerUnavailableError
  ) => void;
}

export class InvalidContextSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContextSearchError";
  }
}

const candidateMultiplier = 4;
const minimumCandidateCount = 12;
const maximumCandidateCount = 100;
const maximumRerankQueryCharacters = 4_000;
const maximumRerankDocumentCharacters = 8_000;

function boundedText(value: string, maximumCharacters: number): string {
  const characters = [...value];
  return characters.length > maximumCharacters
    ? characters.slice(0, maximumCharacters).join("")
    : value;
}

function candidateText(hit: ContextSearchHit): string {
  if (hit.sourceType === "memory") {
    return boundedText(
      `Memory ${hit.memory.kind}\nTitle: ${hit.memory.title}\n${hit.memory.content}`,
      maximumRerankDocumentCharacters
    );
  }
  if (hit.sourceType === "document") {
    return boundedText(
      `Document: ${hit.document.title}\nChunk ${hit.chunk.ordinal + 1}\n${hit.chunk.content}`,
      maximumRerankDocumentCharacters
    );
  }
  return boundedText(
    `Knowledge ${hit.node.kind}\nName: ${hit.node.canonicalName}${
      hit.node.summary ? `\n${hit.node.summary}` : ""
    }`,
    maximumRerankDocumentCharacters
  );
}

function candidateKey(hit: ContextSearchHit): string {
  if (hit.sourceType === "memory") {
    return `memory:${hit.memory.id}`;
  }
  if (hit.sourceType === "document") {
    return `document:${hit.chunk.id}`;
  }
  return `knowledge:${hit.node.id}`;
}

function byScore(left: ContextSearchHit, right: ContextSearchHit): number {
  return (
    right.score - left.score ||
    right.vectorScore - left.vectorScore ||
    right.lexicalScore - left.lexicalScore ||
    candidateKey(left).localeCompare(candidateKey(right))
  );
}

function contextCandidates(
  memories: readonly MemorySearchHit[],
  documents: readonly DocumentSearchHit[],
  knowledge: readonly KnowledgeNodeSearchHit[]
): readonly ContextSearchHit[] {
  return [
    ...memories.map(
      (hit): ContextSearchHit => ({
        ...hit,
        candidateScore: hit.score,
        sourceType: "memory"
      })
    ),
    ...documents.map(
      (hit): ContextSearchHit => ({
        ...hit,
        candidateScore: hit.score,
        sourceType: "document"
      })
    ),
    ...knowledge.map(
      (hit): ContextSearchHit => ({
        ...hit,
        candidateScore: hit.score,
        sourceType: "knowledge"
      })
    )
  ];
}

function candidateLimits(limit: number, rerank: boolean) {
  if (!rerank) {
    return { total: limit * 3, perSource: limit };
  }
  const total = Math.min(
    maximumCandidateCount,
    Math.max(minimumCandidateCount, limit * candidateMultiplier)
  );
  return {
    total,
    perSource: total
  };
}

function balancedCandidates(
  groups: readonly (readonly ContextSearchHit[])[],
  limit: number
): readonly ContextSearchHit[] {
  const candidates: ContextSearchHit[] = [];
  for (let index = 0; candidates.length < limit; index += 1) {
    let added = false;
    for (const group of groups) {
      const candidate = group[index];
      if (candidate) {
        candidates.push(candidate);
        added = true;
        if (candidates.length === limit) {
          break;
        }
      }
    }
    if (!added) {
      break;
    }
  }
  return candidates;
}

async function rankCandidates(
  dependencies: ContextSearchDependencies,
  query: string,
  candidates: readonly ContextSearchHit[],
  limit: number,
  quotaKey: AiRequestQuotaKey,
  signal?: AbortSignal
): Promise<
  Readonly<{
    hits: readonly ContextSearchHit[];
    ranking: "hybrid" | "rerank";
  }>
> {
  const baseline = candidates.toSorted(byScore);
  if (!dependencies.rerankerService || candidates.length === 0) {
    return { hits: baseline.slice(0, limit), ranking: "hybrid" };
  }
  try {
    const scores = await dependencies.rerankerService.rerank({
      query: boundedText(query, maximumRerankQueryCharacters),
      documents: candidates.map(candidateText),
      quotaKey,
      ...(signal ? { signal } : {})
    });
    if (scores.length !== candidates.length) {
      throw new TextRerankerUnavailableError(
        "text reranker response count does not match candidates"
      );
    }
    const minimumScore = dependencies.minimumRerankScore ?? -Infinity;
    return {
      hits: candidates
        .map((candidate, index): ContextSearchHit => ({
          ...candidate,
          rerankScore: scores[index],
          score: scores[index] ?? -Infinity
        }))
        .filter((candidate) => candidate.score >= minimumScore)
        .toSorted(byScore)
        .slice(0, limit),
      ranking: "rerank"
    };
  } catch (error) {
    if (!(error instanceof TextRerankerUnavailableError)) {
      throw error;
    }
    dependencies.onRerankerUnavailable?.(error);
    return { hits: baseline.slice(0, limit), ranking: "hybrid" };
  }
}

export function buildSearchContext(
  dependencies: ContextSearchDependencies,
  sourceTypes: readonly ContextSearchHit["sourceType"][] = ["memory", "document", "knowledge"]
) {
  return async function execute(
    access: OrganizationAccess,
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<ContextSearchResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0 || normalizedQuery.length > 10_000) {
      throw new InvalidContextSearchError(
        "context search query must contain between 1 and 10000 characters"
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidContextSearchError(
        "context search limit must be between 1 and 100"
      );
    }
    const queryEmbedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(normalizedQuery, {
          organizationId: access.organizationId,
          userId: access.userId
        })
      : undefined;
    const limits = candidateLimits(
      limit,
      dependencies.rerankerService !== undefined
    );
    const [memories, documents, knowledge] = await Promise.all([
      sourceTypes.includes("memory")
        ? dependencies.searchMemories(access, normalizedQuery, limits.perSource, queryEmbedding)
        : [],
      sourceTypes.includes("document")
        ? dependencies.searchDocuments(access, normalizedQuery, limits.perSource, queryEmbedding)
        : [],
      sourceTypes.includes("knowledge")
        ? dependencies.searchKnowledge(access, normalizedQuery, limits.perSource, queryEmbedding)
        : []
    ]);
    const candidates = contextCandidates(memories, documents, knowledge);
    const selected = dependencies.rerankerService
      ? balancedCandidates(
          [
            candidates.filter((hit) => hit.sourceType === "memory"),
            candidates.filter((hit) => hit.sourceType === "document"),
            candidates.filter((hit) => hit.sourceType === "knowledge")
          ],
          limits.total
        )
      : candidates;
    const ranked = await rankCandidates(
      dependencies,
      normalizedQuery,
      selected,
      limit,
      { organizationId: access.organizationId, userId: access.userId },
      signal
    );
    return {
      ...ranked,
      counts: {
        memories: memories.length,
        documents: documents.length,
        knowledge: knowledge.length
      }
    };
  };
}
