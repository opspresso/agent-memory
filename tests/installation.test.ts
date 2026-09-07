import { describe, expect, it } from "vitest";

import { installationMembership } from "@/domain/identity/installation";

describe("installation membership", () => {
  it("reserves bootstrap ownership for a configured administrator", () => {
    expect(installationMembership({ isAdmin: false, hasOwner: false }))
      .toEqual({ role: "member", status: "pending" });
    expect(installationMembership({ isAdmin: true, hasOwner: false }))
      .toEqual({ role: "owner", status: "active" });
  });

  it("requires approval for every new member after the owner is established", () => {
    expect(installationMembership({ isAdmin: true, hasOwner: true }))
      .toEqual({ role: "member", status: "pending" });
    expect(installationMembership({ isAdmin: false, hasOwner: true }))
      .toEqual({ role: "member", status: "pending" });
  });

  it.each(["blocked", "removed"] as const)("never reactivates a %s member during login", (status) => {
    expect(installationMembership({
      isAdmin: true, hasOwner: false, existing: { role: "member", status }
    })).toEqual({ role: "member", status });
  });

  it("preserves existing roles and pending approval", () => {
    expect(installationMembership({
      isAdmin: false, hasOwner: true, existing: { role: "admin", status: "pending" }
    })).toEqual({ role: "admin", status: "pending" });
  });
});
