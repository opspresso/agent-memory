import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { version as appVersion } from "../../package.json";

import { contextRecallText } from "@/application/context/context-recall";
import { InvalidContextSearchError } from "@/application/context/search-context";
import { InvalidDocumentSearchError } from "@/application/document/search-documents";
import { DocumentAccessDeniedError, DocumentQuotaExceededError, type UploadDocumentInput } from "@/application/document/upload-document";
import { DocumentNotFoundError } from "@/application/document/get-document";
import { DocumentNotRetryableError } from "@/application/document/retry-document";
import { InvalidDocumentError, type Document } from "@/domain/document/document";
import { KnowledgeNodeNotFoundError } from "@/application/knowledge/create-knowledge-edge";
import { InvalidKnowledgeSearchError } from "@/application/knowledge/search-knowledge-nodes";
import { MemoryNotFoundError } from "@/application/memory/get-memory";
import { MemoryVersionConflictError } from "@/application/memory/revise-memory";
import { MemoryAccessDeniedError } from "@/application/memory/create-memory";
import { InvalidMemorySearchError } from "@/application/memory/search-memories";
import type { ContextSearchResult } from "@/application/context/search-context";
import type { CreateMemoryInput } from "@/application/memory/create-memory";
import type { DocumentSearchHit } from "@/domain/document/document-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type {
  KnowledgeNeighborhood,
  KnowledgeNodeSearchHit
} from "@/domain/knowledge/knowledge-graph-repository";
import type { Memory } from "@/domain/memory/memory";
import { InvalidMemoryError } from "@/domain/memory/memory";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";
import { IngestionConflictError } from "@/domain/shared/ingestion-receipt";

import { publicDocument, publicDocumentHit } from "./document-http";
import { documentIngestSchema } from "./document-schemas";
import { publicContextSearchResult } from "./context-http";
import {
  publicKnowledgeEdge,
  publicKnowledgeHit,
  publicKnowledgeNode
} from "./knowledge-http";
import { publicMemory } from "./memory-http";
import { createMemorySchema } from "./memory-schemas";
import { resolveScopedResource } from "./scoped-resource";
import { logger } from "./observability";

export interface AgentMemoryMcpOperations {
  uploadDocument?(input: UploadDocumentInput): Promise<Document>;
  getDocument?(access: OrganizationAccess, documentId: string): Promise<Document>;
  retryDocument?(access: OrganizationAccess, documentId: string, request: { idempotencyKey: string; expectedAttempts: number }): Promise<Document>;
  searchContext(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<ContextSearchResult>;
  createMemory(input: CreateMemoryInput): Promise<Memory>;
  archiveMemory(
    access: OrganizationAccess,
    memoryId: string,
    expectedVersion: number,
    changeReason?: string
  ): Promise<void>;
  recallMemories(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<ContextSearchResult>;
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

function textResult(text: string, payload: Readonly<Record<string, unknown>>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: payload
  };
}

async function executeMcpTool<T>(execute: () => Promise<T>) {
  try {
    return await execute();
  } catch (error) {
    const publicError =
      error instanceof DocumentAccessDeniedError || error instanceof DocumentQuotaExceededError ||
      error instanceof DocumentNotFoundError || error instanceof DocumentNotRetryableError || error instanceof InvalidDocumentError ||
      error instanceof IngestionConflictError ||
      error instanceof InvalidContextSearchError ||
      error instanceof InvalidDocumentSearchError ||
      error instanceof KnowledgeNodeNotFoundError ||
      error instanceof InvalidKnowledgeSearchError ||
      error instanceof MemoryAccessDeniedError ||
      error instanceof MemoryNotFoundError ||
      error instanceof MemoryVersionConflictError ||
      error instanceof InvalidMemorySearchError ||
      error instanceof InvalidMemoryError ||
      error instanceof AiRequestLimitExceededError;
    if (!publicError) {
      logger.error({ err: error }, "MCP tool execution failed");
    }
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: publicError ? error.message : "Tool execution failed"
      }]
    };
  }
}

const searchInputSchema = {
  query: z.string().trim().min(1).max(10_000),
  limit: z.number().int().min(1).max(100).optional()
};

export function createAgentMemoryMcpServer(
  access: OrganizationAccess,
  operations: AgentMemoryMcpOperations
) {
  const server = new McpServer({ name: "agent-memory", version: appVersion });

  if (operations.uploadDocument && operations.getDocument && operations.retryDocument) {
    server.registerTool("document_ingest", {
      title: "Ingest a document", description: "Store a scoped text document for retrieval. Replays with the same idempotencyKey return the existing document. Check document_ingest_status until ready.",
      inputSchema: documentIngestSchema, annotations: { idempotentHint: true }
    }, async (input) => executeMcpTool(async () => {
      const document = await operations.uploadDocument!({ access, idempotencyKey: input.idempotencyKey,
        scope: resolveScopedResource(input.scope, access.organizationId, access.userId), title: input.title,
        mimeType: input.mimeType, content: new TextEncoder().encode(input.content),
        ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}), ...(input.metadata ? { metadata: input.metadata } : {}) });
      return jsonResult({ document: publicDocument(document) });
    }));
    server.registerTool("document_ingest_status", {
      title: "Read document ingestion status", description: "Read an accessible document's processing status and attempt count.",
      inputSchema: { documentId: z.uuid() }, annotations: { readOnlyHint: true, idempotentHint: true }
    }, async ({ documentId }) => executeMcpTool(async () => jsonResult({ document: publicDocument(await operations.getDocument!(access, documentId)) })));
    server.registerTool("document_ingest_retry", {
      title: "Retry document ingestion", description: "Retry a failed document at its observed processingAttempts. Reuse the same key and expectedAttempts when a response is lost.",
      inputSchema: { documentId: z.uuid(), idempotencyKey: z.string().trim().min(1).max(256), expectedAttempts: z.number().int().min(0) },
      annotations: { idempotentHint: true }
    }, async ({ documentId, idempotencyKey, expectedAttempts }) => executeMcpTool(async () => jsonResult({
      document: publicDocument(await operations.retryDocument!(access, documentId, { idempotencyKey, expectedAttempts }))
    })));
  }

  server.registerTool(
    "context_search",
    {
      title: "Search unified agent context",
      description:
        "Search accessible memories, RAG documents, and knowledge graph nodes in one ranked result.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => executeMcpTool(async () => {
      const result = await operations.searchContext(access, query, limit ?? 10);
      return jsonResult(publicContextSearchResult(result));
    })
  );

  server.registerTool(
    "recall",
    {
      title: "Recall long-term memories",
      description:
        "Recall accessible long-term memories. Returns compact text and memory IDs/versions for forget. Use context_search for RAG and Knowledge Graph context.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => executeMcpTool(async () => {
      const result = await operations.recallMemories(access, query, limit ?? 10);
      const remembered = contextRecallText(result);
      return textResult(remembered, {
        remembered,
        ...publicContextSearchResult(result)
      });
    })
  );

  server.registerTool(
    "remember",
    {
      title: "Create agent memory",
      description: "Create a scoped, durable long-term memory with provenance.",
      inputSchema: createMemorySchema,
      annotations: { idempotentHint: false }
    },
    async (input) => executeMcpTool(async () => {
      const memory = await operations.createMemory({
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
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
    })
  );

  server.registerTool(
    "forget",
    {
      title: "Forget a long-term memory",
      description:
        "Archive a memory so it is excluded from recall and search. Requires manage permission and the current version from remember or recall. Preserves revision history and provenance.",
      inputSchema: {
        memoryId: z.uuid(),
        expectedVersion: z.number().int().min(1),
        changeReason: z.string().trim().min(1).max(1_000).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async ({ memoryId, expectedVersion, changeReason }) => executeMcpTool(async () => {
      await operations.archiveMemory(access, memoryId, expectedVersion, changeReason);
      return jsonResult({ memoryId, forgotten: true });
    })
  );

  server.registerTool(
    "document_search",
    {
      title: "Search RAG documents",
      description: "Search accessible processed document chunks.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => executeMcpTool(async () => {
      const hits = await operations.searchDocuments(access, query, limit ?? 10);
      return jsonResult({ hits: hits.map(publicDocumentHit) });
    })
  );

  server.registerTool(
    "knowledge_search",
    {
      title: "Search knowledge graph",
      description: "Search accessible knowledge graph nodes.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ query, limit }) => executeMcpTool(async () => {
      const hits = await operations.searchKnowledge(access, query, limit ?? 10);
      return jsonResult({ hits: hits.map(publicKnowledgeHit) });
    })
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
    async ({ nodeId, depth, limit }) => executeMcpTool(async () => {
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
    })
  );

  return server;
}
