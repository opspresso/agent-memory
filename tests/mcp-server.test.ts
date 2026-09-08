import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { version as appVersion } from "../package.json";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { buildArchiveMemory } from "@/application/memory/archive-memory";
import { buildCreateMemory } from "@/application/memory/create-memory";
import { buildSearchMemories } from "@/application/memory/search-memories";
import { MemoryNotFoundError } from "@/application/memory/get-memory";
import { MemoryVersionConflictError } from "@/application/memory/revise-memory";
import type { Memory } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";
import { MemoryAccessDeniedError } from "@/application/memory/create-memory";
import {
  createAgentMemoryMcpServer,
  type AgentMemoryMcpOperations
} from "@/lib/mcp-server";

const access: OrganizationAccess = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  userId: "10000000-0000-0000-0000-000000000001",
  role: "member",
  teams: []
};

const servers: ReturnType<typeof createAgentMemoryMcpServer>[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function operations(
  overrides: Partial<AgentMemoryMcpOperations> = {}
): AgentMemoryMcpOperations {
  return {
    searchContext: vi
      .fn()
      .mockResolvedValue({
        hits: [],
        counts: { memories: 0, documents: 0, knowledge: 0 },
        ranking: "hybrid"
      }),
    createMemory: vi.fn(),
    archiveMemory: vi.fn(),
    searchMemories: vi.fn().mockResolvedValue([]),
    searchDocuments: vi.fn().mockResolvedValue([]),
    searchKnowledge: vi.fn().mockResolvedValue([]),
    getKnowledgeNeighborhood: vi
      .fn()
      .mockResolvedValue({ nodes: [], edges: [] }),
    ...overrides
  };
}

async function connectedClient(
  mcpOperations: AgentMemoryMcpOperations,
  principal: OrganizationAccess = access
) {
  const server = createAgentMemoryMcpServer(principal, mcpOperations);
  const client = new Client({ name: "agent-memory-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  servers.push(server);
  clients.push(client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("agent memory MCP server", () => {
  it.each([
    ["context_search", "searchContext", { query: "incident" }],
    ["recall", "searchMemories", { query: "incident" }],
    ["document_search", "searchDocuments", { query: "incident" }],
    ["knowledge_search", "searchKnowledge", { query: "incident" }],
    ["knowledge_neighborhood", "getKnowledgeNeighborhood", {
      nodeId: "60000000-0000-4000-8000-000000000001"
    }],
    ["forget", "archiveMemory", {
      memoryId: "30000000-0000-4000-8000-000000000001", expectedVersion: 1
    }],
    ["remember", "createMemory", {
      kind: "fact", scope: { kind: "user" }, title: "Fact",
      content: "private-memory-content", source: { type: "user" }
    }]
  ] as const)("hides unexpected errors from %s", async (name, operation, input) => {
    const execute = vi.fn().mockRejectedValue(
      new Error("SQL INSERT failed: private-memory-content")
    );
    const client = await connectedClient(operations({
      [operation]: execute
    }));

    const result = await client.callTool({ name, arguments: input });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Tool execution failed" }
    ]);
    expect(JSON.stringify(result)).not.toContain("private-memory-content");
  });

  it("preserves actionable application errors", async () => {
    const client = await connectedClient(operations({
      createMemory: vi.fn().mockRejectedValue(new MemoryAccessDeniedError())
    }));
    const result = await client.callTool({
      name: "remember",
      arguments: {
        kind: "fact", scope: { kind: "organization" }, title: "Fact",
        content: "Content", source: { type: "user" }
      }
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "memory access denied" }]
    });
  });

  it("advertises memory, document, and knowledge tools", async () => {
    const client = await connectedClient(operations());

    const tools = await client.listTools();
    expect(client.getServerVersion()).toMatchObject({
      name: "agent-memory",
      version: appVersion
    });
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "context_search",
      "recall",
      "remember",
      "forget",
      "document_search",
      "knowledge_search",
      "knowledge_neighborhood"
    ]);
  });

  it("recalls only memories with authenticated access and the requested limit", async () => {
    const mcpOperations = operations();
    const client = await connectedClient(mcpOperations);
    const result = await client.callTool({
      name: "recall",
      arguments: { query: "rollback", limit: 5 }
    });

    expect(mcpOperations.searchMemories).toHaveBeenCalledWith(access, "rollback", 5);
    expect(mcpOperations.searchContext).not.toHaveBeenCalled();
    expect(mcpOperations.searchDocuments).not.toHaveBeenCalled();
    expect(mcpOperations.searchKnowledge).not.toHaveBeenCalled();
    expect(result.content).toEqual([{ type: "text", text: "" }]);
    expect(result.structuredContent).toEqual({ remembered: "", count: 0, ranking: "hybrid", hits: [] });
  });

  it.each([{}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: "1" }])(
    "rejects forget without a valid current version: %j", async (input) => {
      const mcpOperations = operations();
      const client = await connectedClient(mcpOperations);
      const result = await client.callTool({
        name: "forget",
        arguments: { memoryId: "30000000-0000-4000-8000-000000000001", ...input }
      });
      expect(result.isError).toBe(true);
      expect(mcpOperations.archiveMemory).not.toHaveBeenCalled();
    }
  );

  it.each([new MemoryAccessDeniedError(), new MemoryNotFoundError(), new MemoryVersionConflictError()])(
    "returns actionable forget errors: %s", async (error) => {
      const client = await connectedClient(operations({ archiveMemory: vi.fn().mockRejectedValue(error) }));
      const result = await client.callTool({
        name: "forget",
        arguments: { memoryId: "30000000-0000-4000-8000-000000000001", expectedVersion: 1 }
      });
      expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: error.message }] });
    }
  );

  it.each(["user", "organization"] as const)(
    "remembers, recalls, and forgets for %s scope through the application lifecycle", async (scopeKind) => {
    const principal: OrganizationAccess = scopeKind === "organization"
      ? { ...access, role: "admin", principalKind: "organization-agent" }
      : access;
    const now = new Date("2026-09-08T00:00:00Z");
    const memoryId = "30000000-0000-4000-8000-000000000001";
    let stored: Memory | undefined;
    const repository: MemoryRepository = {
      save: vi.fn(async (memory) => { stored = memory; }),
      findById: vi.fn(async (organizationId, id) =>
        stored && stored.scope.organizationId === organizationId && stored.id === id ? stored : null),
      listVersions: vi.fn().mockResolvedValue([]),
      saveRevision: vi.fn(async (memory, expectedVersion) => {
        if (stored?.version !== expectedVersion) return "conflict";
        stored = memory;
        return "saved";
      }),
      search: vi.fn(async () => stored ? [{ memory: stored, lexicalScore: 1, vectorScore: 0, score: 1 }] : [])
    };
    const dependencies = { repository, clock: () => now };
    const client = await connectedClient(operations({
      createMemory: buildCreateMemory({ ...dependencies, generateId: () => memoryId }),
      searchMemories: buildSearchMemories(dependencies),
      archiveMemory: buildArchiveMemory(dependencies)
    }), principal);
    const remembered = await client.callTool({
      name: "remember",
      arguments: {
        kind: "decision", scope: { kind: scopeKind }, title: "Rollback",
        content: "Use the previous release.", source: { type: "agent", agentId: "service" }
      }
    });
    expect(remembered.isError).not.toBe(true);
    expect(remembered.structuredContent).toMatchObject({ memory: {
      id: memoryId, version: 1,
      scope: { kind: scopeKind, organizationId: access.organizationId }
    } });
    const recalled = await client.callTool({ name: "recall", arguments: { query: "rollback" } });
    expect(recalled.content).toEqual([{ type: "text", text: `[memory id=${memoryId} version=1] Rollback\nUse the previous release.` }]);
    expect(recalled.structuredContent).toMatchObject({ count: 1, hits: [{ memory: { id: memoryId, version: 1 } }] });

    const otherOrganization = await connectedClient(operations({
      archiveMemory: buildArchiveMemory(dependencies)
    }), { ...principal, organizationId: "90000000-0000-4000-8000-000000000001" });
    const missing = await otherOrganization.callTool({
      name: "forget", arguments: { memoryId, expectedVersion: 1 }
    });
    expect(missing).toMatchObject({ isError: true, content: [{ type: "text", text: "memory not found" }] });
    expect(repository.saveRevision).not.toHaveBeenCalled();

    const otherUser = await connectedClient(operations({
      archiveMemory: buildArchiveMemory(dependencies)
    }), { ...access, userId: "20000000-0000-4000-8000-000000000001" });
    const denied = await otherUser.callTool({ name: "forget", arguments: { memoryId, expectedVersion: 1 } });
    expect(denied).toMatchObject({ isError: true, content: [{ type: "text", text: "memory access denied" }] });
    expect(repository.saveRevision).not.toHaveBeenCalled();

    const stale = await client.callTool({ name: "forget", arguments: { memoryId, expectedVersion: 2 } });
    expect(stale.isError).toBe(true);
    expect(repository.saveRevision).not.toHaveBeenCalled();
    const content = recalled.content as { type: string; text: string }[];
    const reference = content[0]?.text.match(/\[memory id=([0-9a-f-]+) version=(\d+)\]/);
    expect(reference).not.toBeNull();
    const forgotten = await client.callTool({
      name: "forget",
      arguments: {
        memoryId: reference?.[1],
        expectedVersion: Number(reference?.[2]),
        changeReason: "Superseded"
      }
    });
    expect(forgotten.structuredContent).toEqual({ memoryId, forgotten: true });
    expect(repository.saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", version: 2, content: "Use the previous release." }),
      1, access.userId, "Superseded"
    );
    const after = await client.callTool({ name: "recall", arguments: { query: "rollback" } });
    expect(after.structuredContent).toMatchObject({ count: 0, hits: [], remembered: "" });
  });

  it("executes unified context search", async () => {
    const searchContext = vi
      .fn()
      .mockResolvedValue({
        hits: [],
        counts: { memories: 0, documents: 0, knowledge: 0 },
        ranking: "hybrid"
      });
    const client = await connectedClient(operations({ searchContext }));

    const result = await client.callTool({
      name: "context_search",
      arguments: { query: "incident", limit: 7 }
    });

    expect(searchContext).toHaveBeenCalledWith(access, "incident", 7);
    expect(result.structuredContent).toEqual({
      hits: [],
      count: 0,
      counts: { memories: 0, documents: 0, knowledge: 0 },
      ranking: "hybrid"
    });
  });
});
