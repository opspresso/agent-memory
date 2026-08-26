import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { searchContextRecords } from "@/lib/context-service";
import { searchDocumentRecords } from "@/lib/document-service";
import {
  getKnowledgeNeighborhoodRecord,
  searchKnowledgeNodeRecords
} from "@/lib/knowledge-service";
import { createAgentMemoryMcpServer } from "@/lib/mcp-server";
import { organizationIdSchema } from "@/lib/memory-schemas";
import {
  createMemoryRecord,
  searchMemoryRecords
} from "@/lib/memory-service";
import { authorizeOrganizationRequest } from "@/lib/organization-authorization";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

async function handleMcpRequest(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return Response.json({ error: "Invalid organization ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }

  const server = createAgentMemoryMcpServer(authorization.access, {
    searchContext: searchContextRecords,
    createMemory: createMemoryRecord,
    searchMemories: searchMemoryRecords,
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
