import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
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
    createMemory: vi.fn(),
    searchMemories: vi.fn().mockResolvedValue([]),
    searchDocuments: vi.fn().mockResolvedValue([]),
    searchKnowledge: vi.fn().mockResolvedValue([]),
    getKnowledgeNeighborhood: vi
      .fn()
      .mockResolvedValue({ nodes: [], edges: [] }),
    ...overrides
  };
}

async function connectedClient(mcpOperations: AgentMemoryMcpOperations) {
  const server = createAgentMemoryMcpServer(access, mcpOperations);
  const client = new Client({ name: "agent-memory-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  servers.push(server);
  clients.push(client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("agent memory MCP server", () => {
  it("advertises memory, document, and knowledge tools", async () => {
    const client = await connectedClient(operations());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "memory_search",
      "memory_create",
      "document_search",
      "knowledge_search",
      "knowledge_neighborhood"
    ]);
  });

  it("executes search with the authenticated organization access", async () => {
    const searchMemories = vi.fn().mockResolvedValue([]);
    const client = await connectedClient(operations({ searchMemories }));

    const result = await client.callTool({
      name: "memory_search",
      arguments: { query: "rollback", limit: 5 }
    });

    expect(searchMemories).toHaveBeenCalledWith(access, "rollback", 5);
    expect(result.structuredContent).toEqual({ hits: [] });
  });
});
