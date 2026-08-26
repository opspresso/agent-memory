import { describe, expect, it, vi } from "vitest";

import { buildCreateMemory } from "@/application/memory/create-memory";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { InvalidMemoryError, type Memory } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

const now = new Date("2026-08-26T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};

function repositoryWithSave(
  save: MemoryRepository["save"]
): MemoryRepository {
  return {
    save,
    findById: vi.fn(),
    saveRevision: vi.fn(),
    search: vi.fn()
  };
}

describe("create memory", () => {
  it("creates and persists a scoped memory with provenance", async () => {
    const save = vi.fn<(memory: Memory) => Promise<void>>().mockResolvedValue();
    const create = buildCreateMemory({
      clock: () => now,
      generateId: () => "memory-1",
      repository: repositoryWithSave(save)
    });

    const memory = await create({
      access,
      kind: "decision",
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-1"
      },
      title: "  API versioning  ",
      content: "  All public APIs use URL versioning.  ",
      source: {
        type: "agent",
        agentId: "architecture-agent",
        uri: "conversation://decision/42"
      },
    });

    expect(memory).toMatchObject({
      id: "memory-1",
      title: "API versioning",
      content: "All public APIs use URL versioning.",
      version: 1,
      status: "active",
      createdBy: "user-1",
      createdAt: now,
      validFrom: now
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(memory);
  });

  it("rejects an expiry at or before the valid-from time", async () => {
    const create = buildCreateMemory({
      clock: () => now,
      generateId: () => "memory-1",
      repository: repositoryWithSave(vi.fn())
    });

    await expect(
      create({
        access: { ...access, role: "admin" },
        kind: "rule",
        scope: { kind: "organization", organizationId: "organization-1" },
        title: "Retention",
        content: "Keep audit events for one year.",
        source: { type: "user" },
        validFrom: now,
        expiresAt: now
      })
    ).rejects.toThrow(InvalidMemoryError);
  });

  it("rejects writes outside the actor scope", async () => {
    const save = vi.fn<MemoryRepository["save"]>();
    const create = buildCreateMemory({
      clock: () => now,
      generateId: () => "memory-1",
      repository: repositoryWithSave(save)
    });

    await expect(
      create({
        access,
        kind: "fact",
        scope: {
          kind: "team",
          organizationId: "organization-1",
          teamId: "team-2"
        },
        title: "Secret",
        content: "Outside the actor team.",
        source: { type: "user" }
      })
    ).rejects.toThrow("memory access denied");
    expect(save).not.toHaveBeenCalled();
  });
});
