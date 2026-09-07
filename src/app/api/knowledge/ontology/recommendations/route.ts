import { knowledgeErrorResponse } from "@/lib/knowledge-http";
import { recommendKnowledgeOntologyTermRecords } from "@/lib/knowledge-ontology-service";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
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
