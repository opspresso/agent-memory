import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationAgentTokenNotRevealableError } from "@/application/identity/manage-organization-agent-token";

const mocks = vi.hoisted(() => ({
  authorizeOrganizationRoute: vi.fn(),
  reveal: vi.fn()
}));

vi.mock("@/lib/organization-authorization", () => ({
  authorizeOrganizationRoute: mocks.authorizeOrganizationRoute
}));

vi.mock("@/lib/container", () => ({
  organizationAgentTokenUseCases: { reveal: mocks.reveal }
}));

import { POST } from "@/app/api/organizations/[organizationSlug]/agent-token/reveal/route";

const access = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "admin" as const,
  teams: []
};

describe("organization Agent token reveal route", () => {
  beforeEach(() => {
    mocks.authorizeOrganizationRoute.mockReset();
    mocks.reveal.mockReset();
    mocks.authorizeOrganizationRoute.mockResolvedValue({
      authorized: true,
      access,
      user: { id: access.userId }
    });
  });

  it("returns the plaintext only from an explicit uncached POST", async () => {
    mocks.reveal.mockResolvedValue({
      token: "amt_secret",
      createdAt: "2026-08-31T00:00:00.000Z"
    });

    const response = await POST(
      new Request(
        "https://memory.example.com/api/organizations/opspresso/agent-token/reveal",
        { method: "POST" }
      ),
      { params: Promise.resolve({ organizationSlug: "opspresso" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      token: "amt_secret",
      createdAt: "2026-08-31T00:00:00.000Z"
    });
    expect(mocks.reveal).toHaveBeenCalledWith(access);
  });

  it("requires regeneration when a hash-only token cannot be revealed", async () => {
    mocks.reveal.mockRejectedValue(
      new OrganizationAgentTokenNotRevealableError()
    );

    const response = await POST(
      new Request(
        "https://memory.example.com/api/organizations/opspresso/agent-token/reveal",
        { method: "POST" }
      ),
      { params: Promise.resolve({ organizationSlug: "opspresso" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "organization Agent token cannot be revealed; regenerate it"
    });
  });
});
