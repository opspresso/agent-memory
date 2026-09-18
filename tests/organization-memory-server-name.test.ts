import { describe, expect, it } from "vitest";

import { organizationMemoryServerName } from "@/lib/organization-memory-server-name";

describe("organizationMemoryServerName", () => {
  it("uses the display name as an Agent Studio-compatible server slug", () => {
    expect(organizationMemoryServerName("OpsPresso", "default")).toBe(
      "opspresso-memory"
    );
  });

  it("falls back to the organization slug for non-latin names", () => {
    expect(organizationMemoryServerName("조직", "default")).toBe(
      "default-memory"
    );
  });

  it("normalizes separators and trims the result", () => {
    expect(organizationMemoryServerName("  ACME, Inc.  ", "default")).toBe(
      "acme-inc-memory"
    );
  });

  it("does not duplicate the memory suffix", () => {
    expect(organizationMemoryServerName("Agent Memory", "default")).toBe(
      "agent-memory"
    );
  });
});
