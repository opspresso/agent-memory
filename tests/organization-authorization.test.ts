import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  findBySlug: vi.fn(),
  verifyAgentToken: vi.fn()
}));

vi.mock("@/lib/container", () => ({
  organizationAccessRepository: { findBySlug: mocks.findBySlug },
  organizationAgentTokenUseCases: { verify: mocks.verifyAgentToken }
}));

vi.mock("@/lib/session", () => ({
  authenticateRequest: mocks.authenticateRequest
}));

import {
  authorizeOrganizationMcpRoute,
  authorizeOrganizationRoute
} from "@/lib/organization-authorization";

const sessionUser = {
  id: "user-1",
  email: "user@example.com",
  image: null,
  isAdmin: false,
  name: "User"
};
const access = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: sessionUser.id,
  role: "admin" as const,
  teams: []
};

describe("organization route authorization", () => {
  beforeEach(() => {
    mocks.authenticateRequest.mockReset();
    mocks.findBySlug.mockReset();
    mocks.verifyAgentToken.mockReset();
  });

  it("resolves a public organization slug to UUID-backed access", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: sessionUser
    });
    mocks.findBySlug.mockResolvedValue(access);

    const result = await authorizeOrganizationRoute(
      new Request("https://memory.example.com/api/organizations/opspresso/me"),
      "opspresso"
    );

    expect(result).toEqual({ authorized: true, access, user: sessionUser });
    expect(mocks.findBySlug).toHaveBeenCalledWith("opspresso", sessionUser.id);
  });

  it("rejects an invalid organization slug before authentication", async () => {
    const result = await authorizeOrganizationRoute(
      new Request("https://memory.example.com/api/organizations/bad_slug/me"),
      "bad_slug"
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(400);
    }
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("accepts an organization Agent token only on the MCP authorization path", async () => {
    mocks.verifyAgentToken.mockResolvedValue(access);
    const request = new Request(
      "https://memory.example.com/api/organizations/opspresso/mcp",
      {
        method: "POST",
        headers: { authorization: "Bearer amt_secret" }
      }
    );

    const result = await authorizeOrganizationMcpRoute(request, "opspresso");

    expect(result).toEqual({ authorized: true, access });
    expect(mocks.verifyAgentToken).toHaveBeenCalledWith(
      "opspresso",
      "amt_secret"
    );
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("does not accept an organization Agent token on general HTTP routes", async () => {
    const unauthenticated = Response.json(
      { error: "Authentication required" },
      { status: 401 }
    );
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: false,
      response: unauthenticated
    });
    const request = new Request(
      "https://memory.example.com/api/organizations/opspresso/me",
      { headers: { authorization: "Bearer amt_secret" } }
    );

    const result = await authorizeOrganizationRoute(request, "opspresso");

    expect(result).toEqual({ authorized: false, response: unauthenticated });
    expect(mocks.verifyAgentToken).not.toHaveBeenCalled();
  });

  it("returns 401 for a revoked or mismatched Agent token", async () => {
    mocks.verifyAgentToken.mockResolvedValue(null);
    const result = await authorizeOrganizationMcpRoute(
      new Request("https://memory.example.com/api/organizations/opspresso/mcp", {
        method: "POST",
        headers: { authorization: "Bearer amt_revoked" }
      }),
      "opspresso"
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(401);
    }
  });
});
