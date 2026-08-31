import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  knowledgeErrorResponse,
  publicKnowledgeEdge,
  publicKnowledgeNode
} from "@/lib/knowledge-http";
import { knowledgeNodeIdSchema } from "@/lib/knowledge-schemas";
import { getKnowledgeNeighborhoodRecord } from "@/lib/knowledge-service";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string; nodeId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationSlug, nodeId } = await context.params;
  const parsedNodeId = knowledgeNodeIdSchema.safeParse(nodeId);
  if (!parsedNodeId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
  );
  if (!authorization.authorized) {
    return authorization.response;
  }

  const url = new URL(request.url);
  const rawDepth = url.searchParams.get("depth");
  const rawLimit = url.searchParams.get("limit");
  const depth = rawDepth === null ? 1 : Number(rawDepth);
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  try {
    const neighborhood = await getKnowledgeNeighborhoodRecord(
      authorization.access,
      parsedNodeId.data,
      depth,
      limit
    );
    return Response.json({
      nodes: neighborhood.nodes.map(publicKnowledgeNode),
      edges: neighborhood.edges.map(publicKnowledgeEdge)
    });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
