import { MemoryAccessDeniedError } from "@/application/memory/create-memory";
import { MemoryNotFoundError } from "@/application/memory/get-memory";
import { MemoryVersionConflictError } from "@/application/memory/revise-memory";
import { InvalidMemorySearchError } from "@/application/memory/search-memories";
import { InvalidMemoryError } from "@/domain/memory/memory";
import type { Memory } from "@/domain/memory/memory";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";

export function memoryErrorResponse(error: unknown): Response | null {
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

export async function readJsonBody(
  request: Request
): Promise<
  | Readonly<{ valid: true; value: unknown }>
  | Readonly<{ valid: false; response: Response }>
> {
  try {
    return { valid: true, value: await request.json() };
  } catch {
    return {
      valid: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 })
    };
  }
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
  return canAccessMemory(access, "manage", memory)
    ? { ...value, accessGrants: memory.accessGrants }
    : value;
}
