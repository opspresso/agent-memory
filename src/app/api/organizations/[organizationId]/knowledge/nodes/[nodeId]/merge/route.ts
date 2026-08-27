import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  knowledgeErrorResponse,
  publicKnowledgeNode
} from "@/lib/knowledge-http";
import {
  knowledgeNodeIdSchema,
  mergeKnowledgeNodesSchema
} from "@/lib/knowledge-schemas";
import { mergeKnowledgeNodeRecords } from "@/lib/knowledge-service";
import { readJsonBody } from "@/lib/memory-http";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; nodeId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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
  const body = await readJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = mergeKnowledgeNodesSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid knowledge node merge", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const node = await mergeKnowledgeNodeRecords(
      authorization.access,
      parsedNodeId.data,
      parsed.data.sourceNodeId,
      parsed.data.reason
    );
    return Response.json(publicKnowledgeNode(node));
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
