import { MemoryAccessDeniedError } from "@/application/memory/create-memory";
import { MemoryNotFoundError } from "@/application/memory/get-memory";
import { MemoryVersionConflictError } from "@/application/memory/revise-memory";
import { InvalidMemorySearchError } from "@/application/memory/search-memories";
import { InvalidMemoryError } from "@/domain/memory/memory";
import type { Memory } from "@/domain/memory/memory";
import type { MemoryVersionSnapshot } from "@/domain/memory/memory";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";

import { aiErrorResponse } from "./ai-http";

export { readJsonBody } from "./json-body";

export function memoryErrorResponse(error: unknown): Response | null {
  const aiResponse = aiErrorResponse(error);
  if (aiResponse) {
    return aiResponse;
  }
  if (error instanceof MemoryNotFoundError) {
    return Response.json({ error: "Memory not found" }, { status: 404 });
  }
  if (error instanceof MemoryAccessDeniedError) {
    return Response.json({ error: "Memory access denied" }, { status: 403 });
  }
  if (error instanceof MemoryVersionConflictError) {
    return Response.json({ error: "Memory version conflict" }, { status: 409 });
  }
  if (
    error instanceof InvalidMemoryError ||
    error instanceof InvalidMemorySearchError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
}

export function versionEtag(version: number): string {
  return `"${version}"`;
}

export function parseIfMatch(request: Request): number | null {
  const value = request.headers.get("if-match")?.trim();
  const match = value?.match(/^"?([1-9]\d*)"?$/);
  return match ? Number(match[1]) : null;
}

export function publicMemory(memory: Memory) {
  return {
    id: memory.id,
    kind: memory.kind,
    scope: memory.scope,
    title: memory.title,
    content: memory.content,
    source: memory.source,
    createdBy: memory.createdBy,
    validFrom: memory.validFrom,
    ...(memory.expiresAt ? { expiresAt: memory.expiresAt } : {}),
    status: memory.status,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    version: memory.version,
    ...(memory.embedding ? { embeddingModel: memory.embedding.model } : {})
  };
}

export function publicMemoryForAccess(
  memory: Memory,
  access: OrganizationAccess
) {
  const value = publicMemory(memory);
  const manage = canAccessMemory(access, "manage", memory);
  return {
    ...value,
    capabilities: {
      write: canAccessMemory(access, "write", memory),
      manage
    },
    ...(manage ? { accessGrants: memory.accessGrants } : {})
  };
}

export function publicMemoryVersion(version: MemoryVersionSnapshot) {
  return {
    memoryId: version.memoryId,
    version: version.version,
    title: version.title,
    content: version.content,
    source: version.source,
    ...(version.embedding
      ? { embeddingModel: version.embedding.model }
      : {}),
    accessGrants: version.accessGrants,
    validFrom: version.validFrom,
    ...(version.expiresAt ? { expiresAt: version.expiresAt } : {}),
    status: version.status,
    changedBy: version.changedBy,
    ...(version.changeReason
      ? { changeReason: version.changeReason }
      : {}),
    createdAt: version.createdAt
  };
}
