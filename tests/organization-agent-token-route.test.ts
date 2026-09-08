import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeOrganizationRoute: vi.fn(),
  generate: vi.fn(),
  reveal: vi.fn(),
  revoke: vi.fn(),
  status: vi.fn()
}));

vi.mock("@/lib/organization-authorization", () => ({
  authorizeOrganizationRoute: mocks.authorizeOrganizationRoute
}));

vi.mock("@/lib/container", () => ({
  organizationAgentTokenUseCases: {
    generate: mocks.generate,
    reveal: mocks.reveal,
    revoke: mocks.revoke,
    status: mocks.status
  }
}));

import {
  DELETE,
  GET,
  POST
} from "@/app/api/agent-token/route";

const access = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "admin" as const,
  teams: []
};

describe("organization Agent token route", () => {
  beforeEach(() => {
    mocks.authorizeOrganizationRoute.mockReset();
    mocks.generate.mockReset();
    mocks.reveal.mockReset();
    mocks.revoke.mockReset();
    mocks.status.mockReset();
    mocks.authorizeOrganizationRoute.mockResolvedValue({
      authorized: true,
      access,
      user: { id: access.userId }
    });
  });

  it("returns token status without allowing caches", async () => {
    mocks.status.mockResolvedValue({
      configured: true,
      masked: "amt_••••1234",
      createdAt: "2026-08-31T00:00:00.000Z"
    });

    const response = await GET(
      new Request("https://memory.example.com/api/agent-token")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.status).toHaveBeenCalledWith(access);
  });

  it("returns a newly generated plaintext token only from the POST response", async () => {
    mocks.generate.mockResolvedValue({
      token: "amt_secret",
      masked: "amt_••••cret",
      createdAt: "2026-08-31T00:00:00.000Z"
    });

    const response = await POST(
      new Request("https://memory.example.com/api/agent-token", {
        method: "POST"
      })
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ token: "amt_secret" });
  });

  it("revokes the current organization token", async () => {
    const response = await DELETE(
      new Request("https://memory.example.com/api/agent-token", {
        method: "DELETE"
      })
    );

    expect(response.status).toBe(204);
    expect(mocks.revoke).toHaveBeenCalledWith(access);
  });
});
