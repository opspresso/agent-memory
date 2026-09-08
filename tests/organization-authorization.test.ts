import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSearchDocuments } from "@/application/document/search-documents";
import { createDocument, type Document } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import { createAgentMemoryMcpServer } from "@/lib/mcp-server";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getInstallation: vi.fn(),
  findBySlug: vi.fn(),
  findByEmail: vi.fn(),
  verifyAgentToken: vi.fn()
}));

vi.mock("@/lib/installation", () => ({ installationRepository: { get: mocks.getInstallation } }));

vi.mock("@/lib/container", () => ({
  organizationAccessRepository: {
    findBySlug: mocks.findBySlug,
    findByEmail: mocks.findByEmail
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
    mocks.getInstallation.mockResolvedValue({ id: access.organizationId, slug: "opspresso" });
    mocks.authenticateRequest.mockReset();
    mocks.findBySlug.mockReset();
    mocks.findByEmail.mockReset();
    mocks.verifyAgentToken.mockReset();
  });

  it.each([authorizeOrganizationRoute, authorizeOrganizationMcpRoute])("rejects unauthenticated requests before touching the installation", async (authorize) => {
    const response = Response.json({ error: "Authentication required" }, { status: 401 });
    mocks.authenticateRequest.mockResolvedValue({ authenticated: false, response });
    mocks.getInstallation.mockClear();
    await expect(authorize(new Request("https://memory.example.com/api/me"))).resolves.toEqual({ authorized: false, response });
    expect(mocks.getInstallation).not.toHaveBeenCalled();
  });

  it("resolves a public organization slug to UUID-backed access", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: sessionUser
    });
    mocks.findBySlug.mockResolvedValue(access);

    const result = await authorizeOrganizationRoute(
      new Request("https://memory.example.com/api/me", {
        headers: { "x-user-email": "delegated@example.com" }
      })
    );

    expect(result).toEqual({ authorized: true, access, user: sessionUser });
    expect(mocks.findBySlug).toHaveBeenCalledWith("opspresso", sessionUser.id);
  });

  it("uses the installation organization instead of a caller-supplied tenant", async () => {
    mocks.authenticateRequest.mockResolvedValue({ authenticated: true, user: sessionUser });
    mocks.findBySlug.mockResolvedValue(access);
    const result = await authorizeOrganizationRoute(new Request("https://memory.example.com/api/me?organizationId=other"));
    expect(result.authorized).toBe(true);
    expect(mocks.findBySlug).toHaveBeenCalledWith("opspresso", sessionUser.id);
  });

  it("uses a restricted service principal for organization Agent token access", async () => {
    mocks.verifyAgentToken.mockResolvedValue({
      organizationId: access.organizationId,
      userId: access.userId,
      role: access.role
    });
    const request = new Request(
      "https://memory.example.com/api/mcp",
      {
        method: "POST",
        headers: {
          authorization: "Bearer amt_secret"
        }
      }
    );

    const result = await authorizeOrganizationMcpRoute(request);

    expect(result).toEqual({
      authorized: true,
      access: { ...access, principalKind: "organization-agent" }
    });
    expect(mocks.verifyAgentToken).toHaveBeenCalledWith(
      "opspresso",
      "amt_secret"
    );
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("resolves the delegated member's permissions rather than the token issuer's", async () => {
    mocks.verifyAgentToken.mockResolvedValue({
      organizationId: access.organizationId,
      userId: access.userId,
      role: access.role
    });

    const memberAccess = {
      ...access,
      userId: "delegated-user",
      role: "member",
      teams: [{ teamId: "team-1", role: "member" }]
    };
    mocks.findByEmail.mockResolvedValue(memberAccess);
    const result = await authorizeOrganizationMcpRoute(
      new Request("https://memory.example.com/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer amt_secret",
          "X-User-Email": "  Delegated@Example.com  "
        }
      })
    );

    expect(result).toEqual({ authorized: true, access: memberAccess });
    expect(mocks.findByEmail).toHaveBeenCalledWith(
      access.organizationId,
      "delegated@example.com"
    );
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "returns only permitted document chunks over MCP (delegated=%s)",
    async (delegated) => {
      mocks.verifyAgentToken.mockResolvedValue(access);
      const memberAccess = { ...access, userId: "reader", role: "member", teams: [] };
      mocks.findByEmail.mockResolvedValue(memberAccess);
      const authorization = await authorizeOrganizationMcpRoute(
        new Request("https://memory.example.com/api/mcp", {
          headers: {
            authorization: "Bearer amt_secret",
            ...(delegated ? { "X-User-Email": "reader@example.com" } : {})
          }
        })
      );
      expect(authorization.authorized).toBe(true);
      if (!authorization.authorized) throw new Error("Expected authorized MCP request");

      const now = new Date("2026-09-06T00:00:00Z");
      function hit(id: string, owner: string, status: Document["status"] = "ready") {
        return {
          document: {
            ...createDocument({
              id,
              scope: { kind: "user", organizationId: access.organizationId, userId: owner },
              title: "Search fixture",
              objectKey: `objects/${id}`,
              checksum: "a".repeat(64),
              mimeType: "text/plain",
              sizeBytes: 10,
              createdBy: owner,
              now
            }),
            status
          },
          chunk: {
            id: `${id}-chunk`, organizationId: access.organizationId, documentId: id,
            ordinal: 0, content: "유정열 검색 테스트", metadata: {}, createdAt: now
          },
          lexicalScore: 1, vectorScore: 0, score: 1
        };
      }
      const search = vi.fn().mockResolvedValue([
        hit("mine", "reader"), hit("issuer", access.userId),
        hit("someone-else", "other"), hit("archived", "reader", "archived")
      ]);
      const repository: DocumentRepository = {
        save: vi.fn(), findById: vi.fn(), findChunkById: vi.fn(),
        listChunksByDocument: vi.fn(), claimForProcessing: vi.fn(),
        completeProcessing: vi.fn(), failProcessing: vi.fn(),
        markEnqueueFailure: vi.fn(), archive: vi.fn(), search
      };
      const server = createAgentMemoryMcpServer(authorization.access, {
        searchDocuments: buildSearchDocuments({ repository }),
        searchContext: vi.fn(), createMemory: vi.fn(), archiveMemory: vi.fn(), searchMemories: vi.fn(),
        searchKnowledge: vi.fn(), getKnowledgeNeighborhood: vi.fn()
      });
      const client = new Client({ name: "delegation-test", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const result = await client.callTool({
          name: "document_search", arguments: { query: "유정열" }
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          hits: delegated ? [{ document: { id: "mine" } }] : []
        });
        const payload = result.structuredContent as { hits: unknown[] };
        expect(payload.hits).toHaveLength(delegated ? 1 : 0);
        expect(search).toHaveBeenCalledWith({
          access: authorization.access, query: "유정열", limit: 10
        });
      } finally {
        await client.close();
        await server.close();
      }
    }
  );

  it.each(["", "not-an-email", "a@example.com,b@example.com"])(
    "rejects malformed delegated email %j without falling back to the issuer",
    async (email) => {
      mocks.verifyAgentToken.mockResolvedValue(access);
      const result = await authorizeOrganizationMcpRoute(
        new Request("https://memory.example.com/api/mcp", {
          headers: { authorization: "Bearer amt_secret", "X-User-Email": email }
        })
      );
      expect(result.authorized).toBe(false);
      if (!result.authorized) expect(result.response.status).toBe(400);
      expect(mocks.findByEmail).not.toHaveBeenCalled();
    }
  );

  it("denies a delegated identity without active membership in the token organization", async () => {
    mocks.verifyAgentToken.mockResolvedValue(access);
    mocks.findByEmail.mockResolvedValue(null);
    const result = await authorizeOrganizationMcpRoute(
      new Request("https://memory.example.com/api/mcp", {
        headers: {
          authorization: "Bearer amt_secret",
          "X-User-Email": "outsider@example.com"
        }
      })
    );
    expect(result.authorized).toBe(false);
    if (!result.authorized) expect(result.response.status).toBe(403);
    expect(mocks.findByEmail).toHaveBeenCalledWith(access.organizationId, "outsider@example.com");
  });

  it("keeps session MCP requests bound to the authenticated session user", async () => {
    mocks.authenticateRequest.mockResolvedValue({ authenticated: true, user: sessionUser });
    mocks.findBySlug.mockResolvedValue(access);
    const result = await authorizeOrganizationMcpRoute(
      new Request("https://memory.example.com/api/mcp", {
        headers: { authorization: "Bearer session-token", "X-User-Email": "other@example.com" }
      })
    );
    expect(result).toEqual({ authorized: true, access });
    expect(mocks.findByEmail).not.toHaveBeenCalled();
    expect(mocks.verifyAgentToken).not.toHaveBeenCalled();
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
      "https://memory.example.com/api/me",
      { headers: { authorization: "Bearer amt_secret" } }
    );

    const result = await authorizeOrganizationRoute(request);

    expect(result).toEqual({ authorized: false, response: unauthenticated });
    expect(mocks.verifyAgentToken).not.toHaveBeenCalled();
  });

  it("returns 401 for a revoked or mismatched Agent token", async () => {
    mocks.verifyAgentToken.mockResolvedValue(null);
    const result = await authorizeOrganizationMcpRoute(
      new Request("https://memory.example.com/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer amt_revoked", "X-User-Email": "user@example.com" }
      })
    );

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(401);
    }
    expect(mocks.findByEmail).not.toHaveBeenCalled();
  });
});
