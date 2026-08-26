import { describe, expect, it, vi } from "vitest";

import {
  buildCreateOrganization,
  buildCreateTeam,
  buildListOrganizationMembers,
  buildUpsertOrganizationMember,
  buildUpsertTeamMember
} from "@/application/identity/manage-organization";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { OrganizationAdministrationRepository } from "@/domain/identity/organization-administration-repository";

const now = new Date("2026-08-26T00:00:00.000Z");
const ownerAccess: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "owner",
  teams: []
};

function repository(
  overrides: Partial<OrganizationAdministrationRepository> = {}
): OrganizationAdministrationRepository {
  return {
    createOrganization: vi.fn(),
    listOrganizationMembers: vi.fn(),
    upsertOrganizationMember: vi.fn(),
    createTeam: vi.fn(),
    listTeams: vi.fn(),
    upsertTeamMember: vi.fn(),
    ...overrides
  };
}

describe("organization administration", () => {
  it("creates a normalized organization with its authenticated owner", async () => {
    const createOrganization = vi.fn().mockImplementation(
      async (organization) => ({ status: "created", organization })
    );
    const create = buildCreateOrganization({
      clock: () => now,
      generateId: () => "organization-1",
      repository: repository({ createOrganization })
    });

    await expect(create("user-1", " Platform-Team ", " Platform Team ")).resolves
      .toMatchObject({
        id: "organization-1",
        slug: "platform-team",
        name: "Platform Team"
      });
    expect(createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ id: "organization-1" }),
      "user-1"
    );
  });

  it("restricts member administration to organization administrators", async () => {
    const list = buildListOrganizationMembers(repository());
    await expect(
      list({ ...ownerAccess, role: "member" })
    ).rejects.toThrow("organization administration access denied");

    const save = vi.fn().mockResolvedValue({
      status: "saved",
      member: {
        userId: "user-2",
        email: "member@example.com",
        name: "Member",
        role: "owner",
        createdAt: now
      }
    });
    const upsert = buildUpsertOrganizationMember(
      repository({ upsertOrganizationMember: save })
    );
    await expect(
      upsert(
        { ...ownerAccess, role: "admin" },
        "member@example.com",
        "owner"
      )
    ).rejects.toThrow("organization administration access denied");
    await expect(
      upsert(ownerAccess, " MEMBER@example.com ", "owner")
    ).resolves.toMatchObject({ role: "owner" });
    expect(save).toHaveBeenCalledWith(
      "organization-1",
      "member@example.com",
      "owner"
    );
  });

  it("lets team managers assign existing organization members", async () => {
    const save = vi.fn().mockResolvedValue({
      status: "saved",
      member: {
        teamId: "team-1",
        userId: "user-2",
        email: "member@example.com",
        name: "Member",
        role: "member",
        createdAt: now
      }
    });
    const upsert = buildUpsertTeamMember(
      repository({ upsertTeamMember: save })
    );
    const managerAccess: OrganizationAccess = {
      ...ownerAccess,
      role: "member",
      teams: [{ teamId: "team-1", role: "manager" }]
    };

    await expect(
      upsert(managerAccess, "team-2", "member@example.com", "member")
    ).rejects.toThrow("organization administration access denied");
    await expect(
      upsert(managerAccess, "team-1", "member@example.com", "member")
    ).resolves.toMatchObject({ teamId: "team-1" });
  });

  it("reserves team creation for organization administrators", async () => {
    const create = buildCreateTeam({
      clock: () => now,
      generateId: () => "team-1",
      repository: repository()
    });

    await expect(
      create({ ...ownerAccess, role: "member" }, "platform", "Platform")
    ).rejects.toThrow("organization administration access denied");
  });
});
