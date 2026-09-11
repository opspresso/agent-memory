import type { ScopedResource } from "./organization-access";

export function scopeCovers(source: ScopedResource, target: ScopedResource): boolean {
  if (source.organizationId !== target.organizationId) return false;
  if (source.kind === "organization") return true;
  if (source.kind === "team" && target.kind === "team") return source.teamId === target.teamId;
  return source.kind === "user" && target.kind === "user" && source.userId === target.userId;
}

export function sameScope(left: ScopedResource, right: ScopedResource): boolean {
  return scopeCovers(left, right) && scopeCovers(right, left);
}
