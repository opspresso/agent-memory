import { describe, expect, it, vi } from "vitest";

import { buildCreateMemory } from "@/application/memory/create-memory";
import { InvalidMemoryError, type Memory } from "@/domain/memory/memory";

const now = new Date("2026-08-26T00:00:00.000Z");

describe("create memory", () => {
  it("creates and persists a scoped memory with provenance", async () => {
    const save = vi.fn<(memory: Memory) => Promise<void>>().mockResolvedValue();
    const create = buildCreateMemory({
      clock: () => now,
      generateId: () => "memory-1",
      repository: { save }
    });

    const memory = await create({
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
      createdBy: "user-1"
    });

    expect(memory).toMatchObject({
      id: "memory-1",
      title: "API versioning",
      content: "All public APIs use URL versioning.",
      version: 1,
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
      repository: { save: vi.fn() }
    });

    await expect(
      create({
        kind: "rule",
        scope: { kind: "organization", organizationId: "organization-1" },
        title: "Retention",
        content: "Keep audit events for one year.",
        source: { type: "user" },
        createdBy: "user-1",
        validFrom: now,
        expiresAt: now
      })
    ).rejects.toThrow(InvalidMemoryError);
  });
});
