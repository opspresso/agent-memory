import { describe, expect, it } from "vitest";

import { updateOrganizationSchema } from "@/lib/organization-administration-schemas";

describe("organization administration HTTP boundary", () => {
  it("rejects a policy that bypasses membership approval", () => {
    expect(updateOrganizationSchema.safeParse({ name: "Organization", newMemberStatus: "active" }).success).toBe(false);
  });
  it("accepts ontology settings within the documented bounds", () => {
    expect(
      updateOrganizationSchema.safeParse({
        ontologyMode: "warn",
        ontology: {
          nodeKinds: ["service", "database"],
          edgePredicates: ["depends_on"]
        }
      }).success
    ).toBe(true);
    expect(updateOrganizationSchema.safeParse({ ontologyMode: "off" }).success).toBe(
      true
    );
  });

  it("rejects ontology settings outside the documented bounds", () => {
    expect(
      updateOrganizationSchema.safeParse({ ontologyMode: "loose" }).success
    ).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({
        ontology: { nodeKinds: ["service"] }
      }).success
    ).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({
        ontology: { nodeKinds: [""], edgePredicates: [] }
      }).success
    ).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({
        ontology: { nodeKinds: ["a".repeat(101)], edgePredicates: [] }
      }).success
    ).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({
        ontology: {
          nodeKinds: Array.from({ length: 201 }, (_, index) => `kind-${index}`),
          edgePredicates: []
        }
      }).success
    ).toBe(false);
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  });
});
