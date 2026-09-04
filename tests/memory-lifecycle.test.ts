import { describe, expect, it, vi } from "vitest";

import { buildArchiveMemory } from "@/application/memory/archive-memory";
import { buildListMemoryVersions } from "@/application/memory/list-memory-versions";
import { buildReviseMemory } from "@/application/memory/revise-memory";
import { buildSearchMemories } from "@/application/memory/search-memories";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";
import {
  archiveMemory,
  createMemory,
  reviseMemory,
  type Memory
} from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

const now = new Date("2026-08-26T00:00:00.000Z");
const later = new Date("2026-08-27T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "manager" }]
};

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    ...createMemory({
      id: "memory-1",
      kind: "decision",
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-1"
      },
      title: "Original title",
      content: "Original content",
      source: { type: "user" },
      createdBy: "user-1",
      validFrom: now,
      now
    }),
    ...overrides
  };
}

function repository(overrides: Partial<MemoryRepository>): MemoryRepository {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    listVersions: vi.fn(),
    saveRevision: vi.fn(),
    search: vi.fn(),
    ...overrides
  };
}

describe("memory lifecycle", () => {
  it("creates immutable revisions and archives without losing content", () => {
    const original = memory();
    const revised = reviseMemory(original, {
      title: "  Revised title  ",
      now: later
    });
    const archived = archiveMemory(revised, later);

    expect(original.title).toBe("Original title");
    expect(revised).toMatchObject({
      title: "Revised title",
      content: "Original content",
      status: "active",
      version: 2,
      updatedAt: later
    });
    expect(archived).toMatchObject({ status: "archived", version: 3 });
  });

  it("applies explicit permission hierarchy to matching principals", () => {
    const granted = memory({
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-2"
      },
      accessGrants: [
        { principalKind: "team", teamId: "team-1", permission: "write" }
      ]
    });

    expect(canAccessMemory(access, "read", granted)).toBe(true);
    expect(canAccessMemory(access, "write", granted)).toBe(true);
    expect(canAccessMemory(access, "manage", granted)).toBe(false);
    expect(
      canAccessMemory(
        { ...access, principalKind: "organization-agent" },
        "read",
        granted
      )
    ).toBe(false);
  });

  it("persists a revision with optimistic concurrency", async () => {
    const existing = memory({
      embedding: { model: "embedding-model", values: [0.1, 0.2] }
    });
    const saveRevision = vi.fn<MemoryRepository["saveRevision"]>().mockResolvedValue("saved");
    const revise = buildReviseMemory({
      clock: () => later,
      repository: repository({
        findById: vi.fn().mockResolvedValue(existing),
        saveRevision
      })
    });

    const revised = await revise({
      access,
      memoryId: existing.id,
      expectedVersion: 1,
      content: "Revised content",
      changeReason: "Decision changed"
    });

    expect(revised).toMatchObject({ content: "Revised content", version: 2 });
    expect(revised.embedding).toBeUndefined();
    expect(saveRevision).toHaveBeenCalledWith(
      revised,
      1,
      "user-1",
      "Decision changed"
    );
  });

  it("requires manage permission and versions access grant changes", async () => {
    const existing = memory({
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-2"
      },
      accessGrants: [
        { principalKind: "team", teamId: "team-1", permission: "write" }
      ]
    });
    const saveRevision = vi
      .fn<MemoryRepository["saveRevision"]>()
      .mockResolvedValue("saved");
    const revise = buildReviseMemory({
      clock: () => later,
      repository: repository({
        findById: vi.fn().mockResolvedValue(existing),
        saveRevision
      })
    });

    await expect(
      revise({
        access,
        memoryId: existing.id,
        expectedVersion: 1,
        accessGrants: []
      })
    ).rejects.toThrow("memory access denied");

    const managed = {
      ...existing,
      accessGrants: [
        {
          principalKind: "team" as const,
          teamId: "team-1",
          permission: "manage" as const
        }
      ]
    };
    const managedRevise = buildReviseMemory({
      clock: () => later,
      repository: repository({
        findById: vi.fn().mockResolvedValue(managed),
        saveRevision
      })
    });
    const revised = await managedRevise({
      access,
      memoryId: existing.id,
      expectedVersion: 1,
      accessGrants: [
        { principalKind: "user", userId: "user-2", permission: "read" }
      ],
      changeReason: "Share with incident lead"
    });

    expect(revised).toMatchObject({
      version: 2,
      accessGrants: [
        { principalKind: "user", userId: "user-2", permission: "read" }
      ]
    });
    expect(saveRevision).toHaveBeenLastCalledWith(
      revised,
      1,
      "user-1",
      "Share with incident lead"
    );
  });

  it("prevents organization Agent principals from revising access grants", async () => {
    const existing = memory({
      scope: { kind: "organization", organizationId: "organization-1" }
    });
    const saveRevision = vi.fn<MemoryRepository["saveRevision"]>();
    const revise = buildReviseMemory({
      clock: () => later,
      repository: repository({
        findById: vi.fn().mockResolvedValue(existing),
        saveRevision
      })
    });

    await expect(
      revise({
        access: {
          ...access,
          role: "admin",
          principalKind: "organization-agent"
        },
        memoryId: existing.id,
        expectedVersion: 1,
        accessGrants: [
          { principalKind: "user", userId: "user-2", permission: "manage" }
        ]
      })
    ).rejects.toThrow("memory access denied");
    expect(saveRevision).not.toHaveBeenCalled();
  });

  it("requires manage permission to archive", async () => {
    const existing = memory();
    const saveRevision = vi.fn<MemoryRepository["saveRevision"]>().mockResolvedValue("saved");
    const archive = buildArchiveMemory({
      clock: () => later,
      repository: repository({
        findById: vi.fn().mockResolvedValue(existing),
        saveRevision
      })
    });

    await archive(access, existing.id, 1, "No longer valid");

    expect(saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", version: 2 }),
      1,
      "user-1",
      "No longer valid"
    );
  });

  it("restricts version history to memory managers", async () => {
    const existing = memory({
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-2"
      },
      accessGrants: [
        { principalKind: "team", teamId: "team-1", permission: "write" }
      ]
    });
    const listVersions = vi.fn().mockResolvedValue([]);
    const list = buildListMemoryVersions(
      repository({
        findById: vi.fn().mockResolvedValue(existing),
        listVersions
      })
    );

    await expect(list(access, existing.id, 20)).rejects.toThrow(
      "memory not found"
    );

    const managed = {
      ...existing,
      accessGrants: [
        {
          principalKind: "team" as const,
          teamId: "team-1",
          permission: "manage" as const
        }
      ]
    };
    const managedList = buildListMemoryVersions(
      repository({
        findById: vi.fn().mockResolvedValue(managed),
        listVersions
      })
    );
    await managedList(access, existing.id, 20, 3);

    expect(listVersions).toHaveBeenCalledWith(
      "organization-1",
      existing.id,
      20,
      3
    );
  });

  it("filters repository search output through the domain policy", async () => {
    const allowed = memory();
    const denied = memory({
      id: "memory-2",
      scope: {
        kind: "user",
        organizationId: "organization-1",
        userId: "user-2"
      }
    });
    const search = buildSearchMemories({
      clock: () => now,
      repository: repository({
        search: vi.fn().mockResolvedValue([
          { memory: allowed, lexicalScore: 1, vectorScore: 0, score: 1 },
          { memory: denied, lexicalScore: 0.5, vectorScore: 0, score: 0.5 }
        ])
      })
    });

    await expect(search(access, "decision", 10)).resolves.toEqual([
      { memory: allowed, lexicalScore: 1, vectorScore: 0, score: 1 }
    ]);
  });
});
