import { describe, expect, it } from "vitest";

import {
  getAdminEmails,
  getAllowedEmailDomains,
  isAdminEmail,
  isAllowedEmailDomain
} from "@/lib/access-control";

describe("access control configuration", () => {
  it("uses the nalbam.com deployment defaults", () => {
    expect(getAllowedEmailDomains({})).toEqual(["nalbam.com"]);
    expect(getAdminEmails({})).toEqual(["me@nalbam.com"]);
  });

  it("normalizes comma-separated overrides", () => {
    const environment = {
      ALLOWED_EMAIL_DOMAINS: " Example.com, CORP.example, ",
      ADMIN_EMAILS: " Admin@Example.com, OPS@example.com, "
    };

    expect(getAllowedEmailDomains(environment)).toEqual([
      "example.com",
      "corp.example"
    ]);
    expect(getAdminEmails(environment)).toEqual([
      "admin@example.com",
      "ops@example.com"
    ]);
  });

  it("restricts sign-in to exact configured domains", () => {
    const domains = ["nalbam.com"];

    expect(isAllowedEmailDomain("User@NALBAM.com", domains)).toBe(true);
    expect(isAllowedEmailDomain("user@sub.nalbam.com", domains)).toBe(false);
    expect(isAllowedEmailDomain("invalid-email", domains)).toBe(false);
  });

  it("treats an empty domain list as unrestricted", () => {
    expect(isAllowedEmailDomain("user@example.com", [])).toBe(true);
  });

  it("matches admins case-insensitively and fails closed for an empty list", () => {
    expect(isAdminEmail("ME@NALBAM.COM", ["me@nalbam.com"])).toBe(true);
    expect(isAdminEmail("user@nalbam.com", ["me@nalbam.com"])).toBe(false);
    expect(isAdminEmail("user@example.com", [])).toBe(false);
  });
});
