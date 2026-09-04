import type { ScopedResource } from "@/domain/identity/organization-access";
import { serializedJsonByteLength } from "@/domain/shared/json-size";

import {
  normalizeKnowledgeKind,
  normalizeKnowledgeName,
  normalizeKnowledgePredicate
} from "./knowledge-identity";

export interface KnowledgeEmbedding {
  readonly model: string;
  readonly values: readonly number[];
}

export interface KnowledgeSource {
  readonly memoryId?: string;
  readonly chunkId?: string;
}

export interface KnowledgeNode {
  readonly id: string;
  readonly scope: ScopedResource;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
  readonly embedding?: KnowledgeEmbedding;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly sources: readonly KnowledgeSource[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface KnowledgeEdge {
  readonly id: string;
  readonly organizationId: string;
  readonly scope: ScopedResource;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly predicate: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly sources: readonly KnowledgeSource[];
  readonly createdAt: Date;
}

export interface NewKnowledgeNode {
  readonly id: string;
  readonly scope: ScopedResource;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
  readonly embedding?: KnowledgeEmbedding;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly source: KnowledgeSource;
  readonly now: Date;
}

export interface NewKnowledgeEdge {
  readonly id: string;
  readonly organizationId: string;
  readonly scope: ScopedResource;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly predicate: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly source: KnowledgeSource;
  readonly now: Date;
}

export class InvalidKnowledgeGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeGraphError";
  }
}

function normalizedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidKnowledgeGraphError(`${label} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new InvalidKnowledgeGraphError(
      `${label} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function validatedProperties(
  properties: Readonly<Record<string, unknown>> | undefined
) {
  const value = properties ?? {};
  if (serializedJsonByteLength(value) > 32_768) {
    throw new InvalidKnowledgeGraphError(
      "knowledge properties must not exceed 32 KiB"
    );
  }
  return Object.freeze({ ...value });
}

function validatedSource(source: KnowledgeSource | undefined) {
  if (!source) {
    throw new InvalidKnowledgeGraphError(
      "knowledge source must reference exactly one memory or document chunk"
    );
  }
  const referenceCount =
    Number(source.memoryId !== undefined) + Number(source.chunkId !== undefined);
  if (referenceCount !== 1) {
    throw new InvalidKnowledgeGraphError(
      "knowledge source must reference exactly one memory or document chunk"
    );
  }
  if (source?.memoryId !== undefined && source.memoryId.trim().length === 0) {
    throw new InvalidKnowledgeGraphError("source memory ID must not be empty");
  }
  if (source?.chunkId !== undefined && source.chunkId.trim().length === 0) {
    throw new InvalidKnowledgeGraphError("source chunk ID must not be empty");
  }
  return Object.freeze({ ...source });
}

function validatedEmbedding(embedding: KnowledgeEmbedding | undefined) {
  if (!embedding) {
    return undefined;
  }
  if (
    embedding.model.trim().length === 0 ||
    embedding.values.length === 0 ||
    embedding.values.some((value) => !Number.isFinite(value))
  ) {
    throw new InvalidKnowledgeGraphError("knowledge embedding is invalid");
  }
  return Object.freeze({
    model: embedding.model.trim(),
    values: Object.freeze([...embedding.values])
  });
}

export function createKnowledgeNode(input: NewKnowledgeNode): KnowledgeNode {
  const embedding = validatedEmbedding(input.embedding);
  const source = validatedSource(input.source);
  const summary = input.summary?.trim();
  if (summary && summary.length > 10_000) {
    throw new InvalidKnowledgeGraphError(
      "knowledge node summary must not exceed 10000 characters"
    );
  }

  return Object.freeze({
    id: input.id,
    scope: Object.freeze({ ...input.scope }),
    kind: normalizedText(
      normalizeKnowledgeKind(input.kind),
      "knowledge node kind",
      100
    ),
    canonicalName: normalizedText(
      normalizeKnowledgeName(input.canonicalName),
      "knowledge node canonical name",
      500
    ),
    ...(summary ? { summary } : {}),
    ...(embedding ? { embedding } : {}),
    properties: validatedProperties(input.properties),
    sources: Object.freeze([source]),
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now)
  });
}

export function createKnowledgeEdge(input: NewKnowledgeEdge): KnowledgeEdge {
  const source = validatedSource(input.source);
  if (input.scope.organizationId !== input.organizationId) {
    throw new InvalidKnowledgeGraphError(
      "knowledge edge scope must belong to its organization"
    );
  }
  const sourceNodeId = normalizedText(
    input.sourceNodeId,
    "knowledge edge source node ID",
    255
  );
  const targetNodeId = normalizedText(
    input.targetNodeId,
    "knowledge edge target node ID",
    255
  );
  if (sourceNodeId === targetNodeId) {
    throw new InvalidKnowledgeGraphError(
      "knowledge edge must not be self-referential"
    );
  }

  return Object.freeze({
    id: input.id,
    organizationId: input.organizationId,
    scope: Object.freeze({ ...input.scope }),
    sourceNodeId,
    targetNodeId,
    predicate: normalizedText(
      normalizeKnowledgePredicate(input.predicate),
      "knowledge edge predicate",
      100
    ),
    properties: validatedProperties(input.properties),
    sources: Object.freeze([source]),
    createdAt: new Date(input.now)
  });
}
