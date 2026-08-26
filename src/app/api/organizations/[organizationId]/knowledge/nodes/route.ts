import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  knowledgeErrorResponse,
  publicKnowledgeHit,
  publicKnowledgeNode
} from "@/lib/knowledge-http";
import { createKnowledgeNodeSchema } from "@/lib/knowledge-schemas";
import {
  createKnowledgeNodeRecord,
  searchKnowledgeNodeRecords
} from "@/lib/knowledge-service";
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
  const parsed = createKnowledgeNodeSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid knowledge node", issues: parsed.error.issues },
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
    const node = await createKnowledgeNodeRecord({
      access: authorization.access,
      scope,
      kind: parsed.data.kind,
      canonicalName: parsed.data.canonicalName,
      ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
      ...(parsed.data.properties ? { properties: parsed.data.properties } : {}),
      ...(parsed.data.source ? { source: parsed.data.source } : {})
    });
    return Response.json(publicKnowledgeNode(node), {
      headers: {
        Location: `/api/organizations/${organizationId}/knowledge/nodes/${node.id}/neighborhood`
      }
    });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function GET(request: Request, context: RouteContext) {
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

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 10 : Number(rawLimit);
  try {
    const hits = await searchKnowledgeNodeRecords(
      authorization.access,
      query,
      limit
    );
    return Response.json({
      hits: hits.map(publicKnowledgeHit),
      total: hits.length
    });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
