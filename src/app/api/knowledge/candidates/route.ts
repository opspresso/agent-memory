import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  knowledgeCandidateErrorResponse,
  publicKnowledgeCandidate
} from "@/lib/knowledge-candidate-http";
import { listKnowledgeCandidateRecords } from "@/lib/knowledge-candidate-service";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  try {
    const candidates = await listKnowledgeCandidateRecords(
      authorization.access,
      limit
    );
    return Response.json({
      candidates: candidates.map(publicKnowledgeCandidate),
      count: candidates.length
    });
  } catch (error) {
    const response = knowledgeCandidateErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
