import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryVersionSnapshot } from "@/domain/memory/memory";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), listVersions: vi.fn() }));
vi.mock("@/lib/organization-authorization", () => ({
  authorizeOrganizationRoute: mocks.authorize
}));
vi.mock("@/lib/memory-service", () => ({
  listMemoryVersionRecords: mocks.listVersions
}));

import { GET } from "@/app/api/memories/[memoryId]/versions/route";

const access = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "member",
  teams: []
};
const memoryId = "00000000-0000-4000-8000-000000000003";
const context = { params: Promise.resolve({ memoryId }) };
const request = (query: string) =>
  new Request(`https://memory.example.com/api/memories/${memoryId}/versions?${query}`);

function snapshot(version: number): MemoryVersionSnapshot {
  const now = new Date("2026-09-08T00:00:00Z");
  return {
    memoryId,
    version,
    title: "Decision",
    content: "Use the verified release.",
    source: { type: "user" },
    accessGrants: [],
    validFrom: now,
    status: "active",
    changedBy: access.userId,
    createdAt: now
  };
}

describe("memory version pagination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, access });
  });

  it("follows returned cursors through the oldest version without an invalid next page", async () => {
    const versions = [snapshot(2), snapshot(1)];
    mocks.listVersions.mockImplementation(async (_access, _id, limit, before) =>
      versions.filter((version) => before === undefined || version.version < before).slice(0, limit)
    );
    const firstResponse = await GET(request("limit=1"), context);
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ nextBefore: 2, versions: [{ version: 2 }] });

    const lastResponse = await GET(request(`limit=1&before=${first.nextBefore}`), context);
    expect(lastResponse.status).toBe(200);
    const last = await lastResponse.json();
    expect(last.versions).toMatchObject([{ version: 1 }]);
    expect(last).not.toHaveProperty("nextBefore");
    expect(mocks.listVersions).toHaveBeenLastCalledWith(access, memoryId, 1, 2);
  });

  it("does not advertise another page for empty or incomplete results", async () => {
    for (const versions of [[], [snapshot(2)]]) {
      mocks.listVersions.mockResolvedValue(versions);
      const response = await GET(request("limit=2"), context);
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("nextBefore");
    }
  });
});
