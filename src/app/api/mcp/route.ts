import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { recallMemoryRecords, searchContextRecords } from "@/lib/context-service";
import { searchDocumentRecords, uploadDocumentRecord, getDocumentRecord, retryDocumentRecord } from "@/lib/document-service";
import { readJsonBody } from "@/lib/json-body";
import { maxDocumentBytes } from "@/domain/document/document";
import {
  getKnowledgeNeighborhoodRecord,
  searchKnowledgeNodeRecords
} from "@/lib/knowledge-service";
import { createAgentMemoryMcpServer } from "@/lib/mcp-server";
import {
  archiveMemoryRecord,
  createMemoryRecord
} from "@/lib/memory-service";
import { authorizeOrganizationMcpRoute } from "@/lib/organization-authorization";
import { withRouteErrorBoundary } from "@/lib/route-error-boundary";


export const runtime = "nodejs";

async function handleMcpRequest(request: Request) {
  const authorization = await authorizeOrganizationMcpRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }

  const server = createAgentMemoryMcpServer(authorization.access, {
    uploadDocument: uploadDocumentRecord,
    getDocument: getDocumentRecord,
    retryDocument: retryDocumentRecord,
    searchContext: searchContextRecords,
    createMemory: createMemoryRecord,
    archiveMemory: archiveMemoryRecord,
    recallMemories: recallMemoryRecords,
    searchDocuments: searchDocumentRecords,
    searchKnowledge: searchKnowledgeNodeRecords,
    getKnowledgeNeighborhood: getKnowledgeNeighborhoodRecord
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true
  });
  await server.connect(transport);
  if (request.method === "POST") {
    // JSON escaping can use six bytes per source byte, plus metadata and the RPC envelope.
    const parsed = await readJsonBody(request, maxDocumentBytes * 6 + 512 * 1024);
    if (!parsed.valid) return parsed.response;
    return transport.handleRequest(request, { parsedBody: parsed.value });
  }
  return transport.handleRequest(request);
}

export const DELETE = withRouteErrorBoundary("DELETE /api/mcp", handleMcpRequest);
export const GET = withRouteErrorBoundary("GET /api/mcp", handleMcpRequest);
export const POST = withRouteErrorBoundary("POST /api/mcp", handleMcpRequest);
