export type ContextSourceType = "document" | "knowledge" | "memory";

export interface ContextResultPresentation {
  readonly sourceType: ContextSourceType;
  readonly sourceLabel: string;
  readonly scopeLabel: string;
  readonly evidenceLabel: string;
  readonly lexicalScore?: number;
  readonly vectorScore?: number;
  readonly score?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceType(hit: Record<string, unknown>): ContextSourceType {
  if (hit.sourceType === "document" || hit.sourceType === "knowledge") {
    return hit.sourceType;
  }
  if (record(hit.document)) {
    return "document";
  }
  if (record(hit.node)) {
    return "knowledge";
  }
  return "memory";
}

export function contextResultPresentation(
  hit: Record<string, unknown>
): ContextResultPresentation {
  const type = sourceType(hit);
  const resource =
    record(hit.memory) ?? record(hit.document) ?? record(hit.node) ?? {};
  const scope = record(resource.scope);
  const sources = Array.isArray(resource.sources) ? resource.sources : [];
  const source = record(sources[0]) ?? record(resource.source);
  const chunk = record(hit.chunk);

  let evidenceLabel = "직접 등록된 Memory";
  if (type === "memory") {
    const sourceName = typeof source?.type === "string" ? source.type : "unknown";
    const version = finiteNumber(resource.version);
    evidenceLabel = `${sourceName} 출처${version ? ` · revision v${version}` : ""}`;
  } else if (type === "document") {
    const ordinal = finiteNumber(chunk?.ordinal);
    const mimeType = typeof resource.mimeType === "string" ? resource.mimeType : "document";
    evidenceLabel = `${mimeType}${ordinal === undefined ? "" : ` · chunk ${ordinal + 1}`}`;
  } else if (source?.memoryId) {
    evidenceLabel = "Memory에서 연결된 지식";
  } else if (source?.chunkId) {
    evidenceLabel = "문서 근거에서 연결된 지식";
  } else {
    evidenceLabel = "Knowledge Graph 근거";
  }

  return {
    sourceType: type,
    sourceLabel:
      type === "memory" ? "Memory" : type === "document" ? "Document" : "Knowledge",
    scopeLabel: typeof scope?.kind === "string" ? scope.kind : "organization",
    evidenceLabel,
    lexicalScore: finiteNumber(hit.lexicalScore),
    vectorScore: finiteNumber(hit.vectorScore),
    score: finiteNumber(hit.score)
  };
}

export function relativeRelevance(score: number | undefined, peak: number): number {
  if (score === undefined || peak <= 0) {
    return 0;
  }
  return Math.round(Math.min(Math.max(score / peak, 0), 1) * 100);
}
