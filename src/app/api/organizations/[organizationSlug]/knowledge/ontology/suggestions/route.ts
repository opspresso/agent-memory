import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { suggestKnowledgeOntologyRecord } from "@/lib/knowledge-ontology-service";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

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
  try {
    const suggestion = await suggestKnowledgeOntologyRecord(
      authorization.access
    );
    return Response.json(suggestion);
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
