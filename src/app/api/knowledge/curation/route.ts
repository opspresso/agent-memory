import { publicKnowledgeCandidate, knowledgeCandidateErrorResponse } from "@/lib/knowledge-candidate-http";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { queueKnowledgeCuration, listKnowledgeCurationHistory } from "@/lib/knowledge-curation-service";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) { return authorization.response; }
  if (!queueKnowledgeCuration) {
    return Response.json({ error: "Knowledge extraction model and document worker must be configured for automatic curation." }, { status: 503 });
  }
  try {
    return Response.json(await queueKnowledgeCuration(authorization.access, new URL(request.url).searchParams.get("query") ?? undefined), { status: 202 });
  } catch (error) {
    const response = knowledgeCandidateErrorResponse(error);
    if (response) { return response; }
    throw error;
  }
}

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) { return authorization.response; }
  const sources = await listKnowledgeCurationHistory(authorization.access);
  return Response.json({ sources: sources.map((source) => ({ ...source, candidate: publicKnowledgeCandidate(source.candidate) })) });
}
