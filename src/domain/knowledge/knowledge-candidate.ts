import type { ScopedResource } from "@/domain/identity/organization-access";
import type { KnowledgeCandidateAssessment } from "./knowledge-assessment";

import {
  normalizeKnowledgeKind,
  normalizeKnowledgeName,
  normalizeKnowledgePredicate
} from "./knowledge-identity";

export const knowledgeCandidateStatuses = [
  "pending",
  "accepted",
  "rejected"
] as const;

export type KnowledgeCandidateStatus =
  (typeof knowledgeCandidateStatuses)[number];

export interface ProposedKnowledgeEntity {
  readonly key: string;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
  readonly aliases?: readonly string[];
  readonly evidence?: readonly string[];
}

export interface ProposedKnowledgeRelationship {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly predicate: string;
  readonly evidence?: readonly string[];
}

export interface ProposedKnowledgeGraph {
  readonly entities: readonly ProposedKnowledgeEntity[];
  readonly relationships: readonly ProposedKnowledgeRelationship[];
}

export interface KnowledgeCandidateSelection {
  readonly entityKeys: readonly string[];
  readonly relationshipIndexes: readonly number[];
}

export interface KnowledgeCandidateItemReview {
  readonly item: string;
  readonly decision: "accepted" | "rejected";
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly reason?: string;
  readonly method?: "human" | "automatic";
}

export interface KnowledgeCandidate {
  readonly id: string;
  readonly scope: ScopedResource;
  readonly documentId: string;
  readonly chunkId: string;
  readonly model: string;
  readonly graph: ProposedKnowledgeGraph;
  readonly status: KnowledgeCandidateStatus;
  readonly itemReviews?: readonly KnowledgeCandidateItemReview[];
  readonly assessment?: KnowledgeCandidateAssessment;
  readonly reviewedBy?: string;
  readonly reviewReason?: string;
  readonly reviewedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface NewKnowledgeCandidate {
  readonly id: string;
  readonly scope: ScopedResource;
  readonly documentId: string;
  readonly chunkId: string;
  readonly model: string;
  readonly graph: ProposedKnowledgeGraph;
  readonly now: Date;
}

export class InvalidKnowledgeCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeCandidateError";
  }
}

function normalizedText(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidKnowledgeCandidateError(`${label} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new InvalidKnowledgeCandidateError(
      `${label} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function normalizedList(values: readonly string[], label: string, maximum: number) {
  if (values.length > 20) {
    throw new InvalidKnowledgeCandidateError(`${label} must contain at most 20 items`);
  }
  return Object.freeze([...new Set(values.map((value) => normalizedText(value, label, maximum)))]);
}

function normalizedGraph(graph: ProposedKnowledgeGraph): ProposedKnowledgeGraph {
  if (graph.entities.length > 100 || graph.relationships.length > 200) {
    throw new InvalidKnowledgeCandidateError(
      "knowledge candidate exceeds the entity or relationship limit"
    );
  }
  const entities = graph.entities.map((entity) => ({
    key: normalizedText(entity.key, "entity key", 100),
    kind: normalizedText(
      normalizeKnowledgeKind(entity.kind),
      "entity kind",
      100
    ),
    canonicalName: normalizedText(
      normalizeKnowledgeName(entity.canonicalName),
      "entity canonical name",
      500
    ),
    ...(entity.aliases ? { aliases: normalizedList(entity.aliases, "entity aliases", 500) } : {}),
    ...(entity.evidence ? { evidence: normalizedList(entity.evidence, "entity evidence", 2_000) } : {}),
    ...(entity.summary?.trim()
      ? {
          summary: normalizedText(entity.summary, "entity summary", 10_000)
        }
      : {})
  }));
  const keys = new Set(entities.map((entity) => entity.key));
  if (keys.size !== entities.length) {
    throw new InvalidKnowledgeCandidateError("entity keys must be unique");
  }
  const relationships = graph.relationships.map((relationship) => {
    const sourceKey = normalizedText(
      relationship.sourceKey,
      "relationship source key",
      100
    );
    const targetKey = normalizedText(
      relationship.targetKey,
      "relationship target key",
      100
    );
    if (!keys.has(sourceKey) || !keys.has(targetKey)) {
      throw new InvalidKnowledgeCandidateError(
        "relationship endpoints must reference candidate entities"
      );
    }
    if (sourceKey === targetKey) {
      throw new InvalidKnowledgeCandidateError(
        "knowledge candidate relationship must not be self-referential"
      );
    }
    return {
      sourceKey,
      targetKey,
      predicate: normalizedText(
        normalizeKnowledgePredicate(relationship.predicate),
        "relationship predicate",
        100
      ),
      ...(relationship.evidence ? { evidence: normalizedList(relationship.evidence, "relationship evidence", 2_000) } : {})
    };
  });
  return Object.freeze({
    entities: Object.freeze(entities.map((entity) => Object.freeze(entity))),
    relationships: Object.freeze(
      relationships.map((relationship) => Object.freeze(relationship))
    )
  });
}

export function createKnowledgeCandidate(
  input: NewKnowledgeCandidate
): KnowledgeCandidate {
  if (input.scope.organizationId.trim().length === 0) {
    throw new InvalidKnowledgeCandidateError(
      "knowledge candidate organization ID must not be empty"
    );
  }
  return Object.freeze({
    id: normalizedText(input.id, "knowledge candidate ID", 255),
    scope: Object.freeze({ ...input.scope }),
    documentId: normalizedText(input.documentId, "document ID", 255),
    chunkId: normalizedText(input.chunkId, "document chunk ID", 255),
    model: normalizedText(input.model, "extraction model", 255),
    graph: normalizedGraph(input.graph),
    status: "pending",
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now)
  });
}
