import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { knowledgeEdgeIdSchema } from "@/lib/knowledge-schemas";
import { deleteKnowledgeEdgeRecord } from "@/lib/knowledge-service";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; edgeId: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId, edgeId } = await context.params;
  const parsedEdgeId = knowledgeEdgeIdSchema.safeParse(edgeId);
  if (!parsedEdgeId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await deleteKnowledgeEdgeRecord(authorization.access, parsedEdgeId.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
