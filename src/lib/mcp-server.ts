import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CreateMemoryInput } from "@/application/memory/create-memory";
import type { ContextSearchResult } from "@/application/context/search-context";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { DocumentSearchHit } from "@/domain/document/document-repository";
import type {
  KnowledgeNeighborhood,
  KnowledgeNodeSearchHit
} from "@/domain/knowledge/knowledge-graph-repository";
import type { Memory } from "@/domain/memory/memory";
import type { MemorySearchHit } from "@/domain/memory/memory-repository";

import { publicDocumentHit } from "./document-http";
import { publicContextSearchResult } from "./context-http";
import {
  publicKnowledgeEdge,
  publicKnowledgeHit,
  publicKnowledgeNode
} from "./knowledge-http";
import { publicMemory } from "./memory-http";
import { createMemorySchema } from "./memory-schemas";
import { resolveScopedResource } from "./scoped-resource";

export interface AgentMemoryMcpOperations {
  searchContext(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<ContextSearchResult>;
  createMemory(input: CreateMemoryInput): Promise<Memory>;
  searchMemories(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<readonly MemorySearchHit[]>;
  searchDocuments(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<readonly DocumentSearchHit[]>;
  searchKnowledge(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<readonly KnowledgeNodeSearchHit[]>;
  getKnowledgeNeighborhood(
    access: OrganizationAccess,
    nodeId: string,
    depth: number,
    limit: number
  ): Promise<KnowledgeNeighborhood>;
}

function jsonResult(payload: Readonly<Record<string, unknown>>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload
  };
}

const searchInputSchema = {
  query: z.string().trim().min(1).max(10_000),
  limit: z.number().int().min(1).max(100).optional()
};

export function createAgentMemoryMcpServer(
  access: OrganizationAccess,
  operations: AgentMemoryMcpOperations
) {
  const server = new McpServer({ name: "agent-memory", version: "1.0.0" });

  server.registerTool(
    "context_search",
    {
      title: "Search unified agent context",
      description:
        "Search accessible memories, RAG documents, and knowledge graph nodes in one ranked result.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => {
      const result = await operations.searchContext(access, query, limit ?? 10);
      return jsonResult(publicContextSearchResult(result));
    }
  );

  server.registerTool(
    "memory_search",
    {
      title: "Search agent memories",
      description:
        "Search accessible long-term memories with lexical and semantic ranking.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => {
      const hits = await operations.searchMemories(access, query, limit ?? 10);
      return jsonResult({
        hits: hits.map((hit) => ({ ...hit, memory: publicMemory(hit.memory) }))
      });
    }
  );

  server.registerTool(
    "memory_create",
    {
      title: "Create agent memory",
      description: "Create a scoped, durable long-term memory with provenance.",
      inputSchema: createMemorySchema,
      annotations: { idempotentHint: false }
    },
    async (input) => {
      const memory = await operations.createMemory({
        access,
        kind: input.kind,
        scope: resolveScopedResource(
          input.scope,
          access.organizationId,
          access.userId
        ),
        title: input.title,
        content: input.content,
        source: input.source,
        ...(input.accessGrants !== undefined
          ? { accessGrants: input.accessGrants }
          : {}),
        ...(input.validFrom ? { validFrom: new Date(input.validFrom) } : {}),
        ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {})
      });
      return jsonResult({ memory: publicMemory(memory) });
    }
  );

  server.registerTool(
    "document_search",
    {
      title: "Search RAG documents",
      description: "Search accessible processed document chunks.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => {
      const hits = await operations.searchDocuments(access, query, limit ?? 10);
      return jsonResult({ hits: hits.map(publicDocumentHit) });
    }
  );

  server.registerTool(
    "knowledge_search",
    {
      title: "Search knowledge graph",
      description: "Search accessible knowledge graph nodes.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => {
      const hits = await operations.searchKnowledge(access, query, limit ?? 10);
      return jsonResult({ hits: hits.map(publicKnowledgeHit) });
    }
  );

  server.registerTool(
    "knowledge_neighborhood",
    {
      title: "Traverse knowledge graph",
      description:
        "Return an accessible bounded neighborhood around a knowledge node.",
      inputSchema: {
        nodeId: z.uuid(),
        depth: z.number().int().min(1).max(5).optional(),
        limit: z.number().int().min(1).max(200).optional()
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ nodeId, depth, limit }) => {
      const neighborhood = await operations.getKnowledgeNeighborhood(
        access,
        nodeId,
        depth ?? 1,
        limit ?? 100
      );
      return jsonResult({
        nodes: neighborhood.nodes.map(publicKnowledgeNode),
        edges: neighborhood.edges.map(publicKnowledgeEdge)
      });
    }
  );

  return server;
}
