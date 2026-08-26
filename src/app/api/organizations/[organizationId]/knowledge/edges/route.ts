import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  knowledgeErrorResponse,
  publicKnowledgeEdge
} from "@/lib/knowledge-http";
import { createKnowledgeEdgeSchema } from "@/lib/knowledge-schemas";
import { createKnowledgeEdgeRecord } from "@/lib/knowledge-service";
import { readJsonBody } from "@/lib/memory-http";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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

  const body = await readJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = createKnowledgeEdgeSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid knowledge edge", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const scope =
    parsed.data.scope.kind === "organization"
      ? {
          kind: "organization" as const,
          organizationId: parsedOrganizationId.data
        }
      : parsed.data.scope.kind === "team"
        ? {
            kind: "team" as const,
            organizationId: parsedOrganizationId.data,
            teamId: parsed.data.scope.teamId
          }
        : {
            kind: "user" as const,
            organizationId: parsedOrganizationId.data,
            userId: parsed.data.scope.userId ?? authorization.user.id
          };

  try {
    const edge = await createKnowledgeEdgeRecord({
      access: authorization.access,
      scope,
      sourceNodeId: parsed.data.sourceNodeId,
      targetNodeId: parsed.data.targetNodeId,
      predicate: parsed.data.predicate,
      ...(parsed.data.properties ? { properties: parsed.data.properties } : {}),
      ...(parsed.data.source ? { source: parsed.data.source } : {})
    });
    return Response.json(publicKnowledgeEdge(edge));
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
