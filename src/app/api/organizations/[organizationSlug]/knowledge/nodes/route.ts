import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
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
import { resolveScopedResource } from "@/lib/scoped-resource";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
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
  const scope = resolveScopedResource(
    parsed.data.scope,
    authorization.access.organizationId,
    authorization.user.id
  );

  try {
    const { node, ontologyWarnings } = await createKnowledgeNodeRecord({
      access: authorization.access,
      scope,
      kind: parsed.data.kind,
      canonicalName: parsed.data.canonicalName,
      ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
      ...(parsed.data.properties ? { properties: parsed.data.properties } : {}),
      source: parsed.data.source
    });
    return Response.json(
      {
        ...publicKnowledgeNode(node),
        ...(ontologyWarnings.length > 0 ? { ontologyWarnings } : {})
      },
      {
        headers: {
          Location: `/api/organizations/${organizationSlug}/knowledge/nodes/${node.id}/neighborhood`
        }
      }
    );
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
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
      count: hits.length
    });
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
