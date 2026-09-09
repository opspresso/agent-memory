import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { listKnowledgeReviewGroups } from "@/lib/knowledge-candidate-service";
import { knowledgeCandidateErrorResponse } from "@/lib/knowledge-candidate-http";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) { return authorization.response; }
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await listKnowledgeReviewGroups(authorization.access, {
      offset: Number(params.get("offset") ?? 0), limit: Number(params.get("limit") ?? 25),
      query: params.get("query") ?? undefined
    }));
  } catch (error) {
    const response = knowledgeCandidateErrorResponse(error);
    if (response) { return response; }
    throw error;
  }
}
