import { withRouteErrorBoundary } from "@/lib/route-error-boundary";
import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { suggestKnowledgeOntologyRecord } from "@/lib/knowledge-ontology-service";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

export const POST = withRouteErrorBoundary("POST /api/knowledge/ontology/suggestions", async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
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
});
