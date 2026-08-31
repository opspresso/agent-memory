import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { recommendKnowledgeOntologyTermRecords } from "@/lib/knowledge-ontology-service";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string }>;
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
  try {
    const recommendation = await recommendKnowledgeOntologyTermRecords(
      authorization.access
    );
    return Response.json(recommendation);
  } catch (error) {
    const response = knowledgeErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
