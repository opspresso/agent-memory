import { describe, expect, it } from "vitest";

import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";

const memberAccess: OrganizationAccess = {
  organizationId: "organization-a",
  userId: "user-a",
  role: "member",
  teams: [
    { teamId: "team-member", role: "member" },
    { teamId: "team-manager", role: "manager" }
  ]
};

describe("organization access policy", () => {
  it("rejects resources in another organization", () => {
    expect(
      canAccessScopedResource(memberAccess, "read", {
        kind: "organization",
        organizationId: "organization-b"
      })
    ).toBe(false);
  });

  it("lets members read organization scope but reserves writes for admins", () => {
    const scope = { kind: "organization", organizationId: "organization-a" } as const;

    expect(canAccessScopedResource(memberAccess, "read", scope)).toBe(true);
    expect(canAccessScopedResource(memberAccess, "write", scope)).toBe(false);
    expect(
      canAccessScopedResource({ ...memberAccess, role: "admin" }, "write", scope)
    ).toBe(true);
  });

  it("lets team members write and team managers manage their team", () => {
    const memberScope = {
      kind: "team",
      organizationId: "organization-a",
      teamId: "team-member"
    } as const;
    const managerScope = { ...memberScope, teamId: "team-manager" };

    expect(canAccessScopedResource(memberAccess, "write", memberScope)).toBe(true);
    expect(canAccessScopedResource(memberAccess, "manage", memberScope)).toBe(false);
    expect(canAccessScopedResource(memberAccess, "manage", managerScope)).toBe(true);
  });

  it("restricts user scope to its owner", () => {
    expect(
      canAccessScopedResource(memberAccess, "write", {
        kind: "user",
        organizationId: "organization-a",
        userId: "user-a"
      })
    ).toBe(true);
    expect(
      canAccessScopedResource(
        { ...memberAccess, role: "owner" },
        "manage",
        {
          kind: "user",
          organizationId: "organization-a",
          userId: "user-b"
        }
      )
    ).toBe(false);
  });
});
