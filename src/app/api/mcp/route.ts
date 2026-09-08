import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { recallMemoryRecords, searchContextRecords } from "@/lib/context-service";
import { searchDocumentRecords } from "@/lib/document-service";
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


export const runtime = "nodejs";

async function handleMcpRequest(request: Request) {
  const authorization = await authorizeOrganizationMcpRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }

  const server = createAgentMemoryMcpServer(authorization.access, {
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
  return transport.handleRequest(request);
}

export {
  handleMcpRequest as DELETE,
  handleMcpRequest as GET,
  handleMcpRequest as POST
};
