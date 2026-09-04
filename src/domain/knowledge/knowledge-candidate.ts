import type { ScopedResource } from "@/domain/identity/organization-access";

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
}

export interface ProposedKnowledgeRelationship {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly predicate: string;
}

export interface ProposedKnowledgeGraph {
  readonly entities: readonly ProposedKnowledgeEntity[];
  readonly relationships: readonly ProposedKnowledgeRelationship[];
}

export interface KnowledgeCandidate {
  readonly id: string;
  readonly scope: ScopedResource;
  readonly documentId: string;
  readonly chunkId: string;
  readonly model: string;
  readonly graph: ProposedKnowledgeGraph;
  readonly status: KnowledgeCandidateStatus;
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
      )
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
