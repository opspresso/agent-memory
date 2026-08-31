import { describe, expect, it } from "vitest";

import { resolveScopedResource } from "@/lib/scoped-resource";

const organizationId = "11111111-1111-4111-8111-111111111111";
const fallbackUserId = "22222222-2222-4222-8222-222222222222";

describe("resolveScopedResource", () => {
  it("maps an organization scope onto the route organization", () => {
    expect(
      resolveScopedResource({ kind: "organization" }, organizationId, fallbackUserId)
    ).toEqual({ kind: "organization", organizationId });
  });

  it("maps a team scope with its team id", () => {
    const teamId = "33333333-3333-4333-8333-333333333333";

    expect(
      resolveScopedResource({ kind: "team", teamId }, organizationId, fallbackUserId)
    ).toEqual({ kind: "team", organizationId, teamId });
  });

  it("keeps an explicitly provided user id", () => {
    const userId = "44444444-4444-4444-8444-444444444444";

    expect(
      resolveScopedResource({ kind: "user", userId }, organizationId, fallbackUserId)
    ).toEqual({ kind: "user", organizationId, userId });
  });

  it("falls back to the authenticated user id when none is provided", () => {
    expect(
      resolveScopedResource({ kind: "user" }, organizationId, fallbackUserId)
    ).toEqual({ kind: "user", organizationId, userId: fallbackUserId });
  });

  it("only uses the passed organization id, never one from the scope input", () => {
    const bodyScope = {
      kind: "organization",
      organizationId: "99999999-9999-4999-8999-999999999999"
    } as const;

    expect(
      resolveScopedResource(bodyScope, organizationId, fallbackUserId)
    ).toEqual({ kind: "organization", organizationId });
  });
});
