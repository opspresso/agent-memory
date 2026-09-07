import { describe, expect, it } from "vitest";

import { installationMembership } from "@/domain/identity/installation";

describe("installation membership", () => {
  it("reserves bootstrap ownership for a configured administrator", () => {
    expect(installationMembership({ isAdmin: false, hasOwner: false, newMemberStatus: "pending" }))
      .toEqual({ role: "member", status: "pending" });
    expect(installationMembership({ isAdmin: true, hasOwner: false, newMemberStatus: "pending" }))
      .toEqual({ role: "owner", status: "active" });
  });

  it("applies admission policy after the owner is established", () => {
    expect(installationMembership({ isAdmin: true, hasOwner: true, newMemberStatus: "pending" }))
      .toEqual({ role: "member", status: "pending" });
    expect(installationMembership({ isAdmin: false, hasOwner: true, newMemberStatus: "active" }))
      .toEqual({ role: "member", status: "active" });
  });

  it.each(["blocked", "removed"] as const)("never reactivates a %s member during login", (status) => {
    expect(installationMembership({
      isAdmin: true, hasOwner: false, newMemberStatus: "active", existing: { role: "member", status }
    })).toEqual({ role: "member", status });
  });

  it("preserves existing roles and pending approval", () => {
    expect(installationMembership({
      isAdmin: false, hasOwner: true, newMemberStatus: "active", existing: { role: "admin", status: "pending" }
    })).toEqual({ role: "admin", status: "pending" });
  });
});
