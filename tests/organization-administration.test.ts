import { describe, expect, it, vi } from "vitest";

import {
  buildCreateOrganization,
  buildCreateTeam,
  buildDeleteOrganization,
  buildDeleteTeam,
  buildJoinOrganization,
  buildListOrganizationMembers,
  buildListTeamMembers,
  buildRemoveOrganizationMember,
  buildUpdateOrganizationMember,
  buildUpdateOrganizationSettings,
  buildUpsertOrganizationMember,
  buildUpsertTeamMember
} from "@/application/identity/manage-organization";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { OrganizationAdministrationRepository } from "@/domain/identity/organization-administration-repository";
import {
  defaultKnowledgeOntology,
  defaultKnowledgeOntologyMode
} from "@/domain/knowledge/knowledge-ontology";

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
    findOrganization: vi.fn(),
    updateOrganizationSettings: vi.fn(),
    deleteOrganization: vi.fn(),
    listOrganizationMembers: vi.fn(),
    findOrganizationMember: vi.fn(),
    upsertOrganizationMember: vi.fn(),
    updateOrganizationMember: vi.fn(),
    removeOrganizationMember: vi.fn(),
    createTeam: vi.fn(),
    listTeams: vi.fn(),
    updateTeam: vi.fn(),
    deleteTeam: vi.fn(),
    listTeamMembers: vi.fn(),
    upsertTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
    listJoinableOrganizations: vi.fn(),
    joinOrganizationBySlug: vi.fn(),
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
        name: "Platform Team",
        newMemberStatus: "pending",
        defaultTeamId: null,
        ontologyMode: defaultKnowledgeOntologyMode,
        ontology: defaultKnowledgeOntology
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
        status: "active",
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

  it("updates organization settings for administrators only", async () => {
    const updateOrganizationSettings = vi.fn().mockImplementation(
      async (_organizationId, update) => ({
        status: "updated",
        organization: {
          id: "organization-1",
          slug: "platform",
          name: update.name ?? "Platform",
          newMemberStatus: update.newMemberStatus ?? "active",
          defaultTeamId: update.defaultTeamId ?? null,
          createdAt: now,
          updatedAt: now
        }
      })
    );
    const update = buildUpdateOrganizationSettings(
      repository({ updateOrganizationSettings })
    );

    await expect(
      update({ ...ownerAccess, role: "member" }, { newMemberStatus: "pending" })
    ).rejects.toThrow("organization administration access denied");
    await expect(
      update(ownerAccess, { name: " Platform Guild ", newMemberStatus: "pending" })
    ).resolves.toMatchObject({
      name: "Platform Guild",
      newMemberStatus: "pending"
    });
    expect(updateOrganizationSettings).toHaveBeenCalledWith(
      "organization-1",
      expect.objectContaining({ name: "Platform Guild" })
    );
  });

  it("normalizes the ontology dictionary before persisting settings", async () => {
    const updateOrganizationSettings = vi.fn().mockImplementation(
      async (_organizationId, update) => ({
        status: "updated",
        organization: { id: "organization-1", ...update }
      })
    );
    const update = buildUpdateOrganizationSettings(
      repository({ updateOrganizationSettings })
    );

    await update(ownerAccess, {
      ontologyMode: "warn",
      ontology: {
        nodeKinds: [" Service ", "service", "Award"],
        edgePredicates: [" DEPENDS_ON "]
      }
    });

    expect(updateOrganizationSettings).toHaveBeenCalledWith("organization-1", {
      ontologyMode: "warn",
      ontology: {
        nodeKinds: ["service", "recognition"],
        edgePredicates: ["depends_on"]
      }
    });
  });

  it("rejects an ontology dictionary above the term limit", async () => {
    const update = buildUpdateOrganizationSettings(repository());

    await expect(
      update(ownerAccess, {
        ontology: {
          nodeKinds: Array.from({ length: 201 }, (_, index) => `kind-${index}`),
          edgePredicates: []
        }
      })
    ).rejects.toThrow("ontology node kinds must contain at most 200 terms");
  });

  it("reserves organization deletion for owners", async () => {
    const deleteOrganization = vi.fn().mockResolvedValue(true);
    const remove = buildDeleteOrganization(
      repository({ deleteOrganization })
    );

    await expect(
      remove({ ...ownerAccess, role: "admin" })
    ).rejects.toThrow("organization administration access denied");
    await expect(remove(ownerAccess)).resolves.toBeUndefined();
    expect(deleteOrganization).toHaveBeenCalledWith("organization-1");
  });

  it("protects members from self and owner-target changes", async () => {
    const findOrganizationMember = vi.fn().mockResolvedValue({
      userId: "user-2",
      email: "member@example.com",
      name: "Member",
      role: "owner",
      status: "active",
      createdAt: now
    });
    const updateOrganizationMember = vi.fn().mockResolvedValue({
      status: "saved",
      member: {
        userId: "user-2",
        email: "member@example.com",
        name: "Member",
        role: "owner",
        status: "blocked",
        createdAt: now
      }
    });
    const update = buildUpdateOrganizationMember(
      repository({ findOrganizationMember, updateOrganizationMember })
    );

    await expect(
      update(ownerAccess, "user-1", { status: "blocked" })
    ).rejects.toThrow("organization members cannot change their own membership");
    await expect(
      update({ ...ownerAccess, role: "admin" }, "user-2", { status: "blocked" })
    ).rejects.toThrow("organization administration access denied");
    await expect(
      update(ownerAccess, "user-2", { status: "blocked" })
    ).resolves.toMatchObject({ status: "blocked" });

    const removeOrganizationMember = vi.fn().mockResolvedValue({
      status: "removed"
    });
    const remove = buildRemoveOrganizationMember(
      repository({ findOrganizationMember, removeOrganizationMember })
    );
    await expect(remove(ownerAccess, "user-1")).rejects.toThrow(
      "organization members cannot change their own membership"
    );
    await expect(remove(ownerAccess, "user-2")).resolves.toBeUndefined();
  });

  it("limits team member listing to administrators and team members", async () => {
    const listTeamMembers = vi.fn().mockResolvedValue([]);
    const list = buildListTeamMembers(repository({ listTeamMembers }));

    await expect(
      list({ ...ownerAccess, role: "member" }, "team-1")
    ).rejects.toThrow("organization administration access denied");
    await expect(
      list(
        { ...ownerAccess, role: "member", teams: [{ teamId: "team-1", role: "member" }] },
        "team-1"
      )
    ).resolves.toEqual([]);
    await expect(list(ownerAccess, "team-1")).resolves.toEqual([]);
  });

  it("reserves team deletion for organization administrators", async () => {
    const deleteTeam = vi.fn().mockResolvedValue(true);
    const remove = buildDeleteTeam(repository({ deleteTeam }));
    const managerAccess: OrganizationAccess = {
      ...ownerAccess,
      role: "member",
      teams: [{ teamId: "team-1", role: "manager" }]
    };

    await expect(remove(managerAccess, "team-1")).rejects.toThrow(
      "organization administration access denied"
    );
    await expect(remove(ownerAccess, "team-1")).resolves.toBeUndefined();
  });

  it("joins an organization with the configured membership status", async () => {
    const joinOrganizationBySlug = vi.fn().mockResolvedValue({
      status: "joined",
      membershipStatus: "pending"
    });
    const join = buildJoinOrganization(repository({ joinOrganizationBySlug }));

    await expect(join("user-1", "organization-p")).resolves.toBe("pending");
    expect(joinOrganizationBySlug).toHaveBeenCalledWith(
      "organization-p",
      "user-1"
    );

    const alreadyMember = buildJoinOrganization(
      repository({
        joinOrganizationBySlug: vi
          .fn()
          .mockResolvedValue({ status: "already_member" })
      })
    );
    await expect(alreadyMember("user-1", "organization-p")).rejects.toThrow(
      "user already belongs to this organization"
    );
  });
});
