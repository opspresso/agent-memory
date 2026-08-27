import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { knowledgeEdgeIdSchema } from "@/lib/knowledge-schemas";
import { deleteKnowledgeEdgeRecord } from "@/lib/knowledge-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; edgeId: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId, edgeId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  const parsedEdgeId = knowledgeEdgeIdSchema.safeParse(edgeId);
  if (!parsedOrganizationId.success || !parsedEdgeId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
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
