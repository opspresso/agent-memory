import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  findByEmail: vi.fn(),
  findBySlug: vi.fn(),
  verifyAgentToken: vi.fn()
}));

vi.mock("@/lib/container", () => ({
  organizationAccessRepository: {
    findByEmail: mocks.findByEmail,
    findBySlug: mocks.findBySlug
  },
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
    mocks.findByEmail.mockReset();
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
      new Request("https://memory.example.com/api/organizations/opspresso/me", {
        headers: { "x-user-email": "delegated@example.com" }
      }),
      "opspresso"
    );

    expect(result).toEqual({ authorized: true, access, user: sessionUser });
    expect(mocks.findBySlug).toHaveBeenCalledWith("opspresso", sessionUser.id);
    expect(mocks.findByEmail).not.toHaveBeenCalled();
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

  it("uses the delegated email membership for organization Agent token access", async () => {
    const delegatedAccess = {
      ...access,
      userId: "user-2",
      role: "member" as const
    };
    mocks.verifyAgentToken.mockResolvedValue(access);
    mocks.findByEmail.mockResolvedValue(delegatedAccess);
    const request = new Request(
      "https://memory.example.com/api/organizations/opspresso/mcp",
      {
        method: "POST",
        headers: {
          authorization: "Bearer amt_secret",
          "x-user-email": " Delegated@Example.com "
        }
      }
    );

    const result = await authorizeOrganizationMcpRoute(request, "opspresso");

    expect(result).toEqual({ authorized: true, access: delegatedAccess });
    expect(mocks.verifyAgentToken).toHaveBeenCalledWith(
      "opspresso",
      "amt_secret"
    );
    expect(mocks.findByEmail).toHaveBeenCalledWith(
      access.organizationId,
      "delegated@example.com"
    );
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("requires a valid delegated email for organization Agent tokens", async () => {
    mocks.verifyAgentToken.mockResolvedValue(access);

    for (const email of [undefined, "not-an-email"]) {
      const headers = new Headers({ authorization: "Bearer amt_secret" });
      if (email) {
        headers.set("x-user-email", email);
      }
      const result = await authorizeOrganizationMcpRoute(
        new Request("https://memory.example.com/api/organizations/opspresso/mcp", {
          method: "POST",
          headers
        }),
        "opspresso"
      );

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.response.status).toBe(400);
      }
    }
    expect(mocks.findByEmail).not.toHaveBeenCalled();
  });

  it("rejects a delegated email without active organization access", async () => {
    mocks.verifyAgentToken.mockResolvedValue(access);
    mocks.findByEmail.mockResolvedValue(null);

    const result = await authorizeOrganizationMcpRoute(
      new Request("https://memory.example.com/api/organizations/opspresso/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer amt_secret",
          "x-user-email": "outsider@example.com"
        }
      }),
      "opspresso"
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(403);
    }
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
    expect(mocks.findByEmail).not.toHaveBeenCalled();
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
    expect(mocks.findByEmail).not.toHaveBeenCalled();
  });
});
