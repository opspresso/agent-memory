import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { knowledgeNodeIdSchema } from "@/lib/knowledge-schemas";
import { deleteKnowledgeNodeRecord } from "@/lib/knowledge-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; nodeId: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId, nodeId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  const parsedNodeId = knowledgeNodeIdSchema.safeParse(nodeId);
  if (!parsedOrganizationId.success || !parsedNodeId.success) {
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
    await deleteKnowledgeNodeRecord(authorization.access, parsedNodeId.data);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
