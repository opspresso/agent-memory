import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  knowledgeErrorResponse,
  publicKnowledgeEdge
} from "@/lib/knowledge-http";
import { createKnowledgeEdgeSchema } from "@/lib/knowledge-schemas";
import { createKnowledgeEdgeRecord } from "@/lib/knowledge-service";
import { readJsonBody } from "@/lib/memory-http";
import { resolveScopedResource } from "@/lib/scoped-resource";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
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
  const scope = resolveScopedResource(
    parsed.data.scope,
    organizationId,
    authorization.user.id
  );

  try {
    const { edge, ontologyWarnings } = await createKnowledgeEdgeRecord({
      access: authorization.access,
      scope,
      sourceNodeId: parsed.data.sourceNodeId,
      targetNodeId: parsed.data.targetNodeId,
      predicate: parsed.data.predicate,
      ...(parsed.data.properties ? { properties: parsed.data.properties } : {}),
      ...(parsed.data.source ? { source: parsed.data.source } : {})
    });
    return Response.json({
      ...publicKnowledgeEdge(edge),
      ...(ontologyWarnings.length > 0 ? { ontologyWarnings } : {})
    });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
