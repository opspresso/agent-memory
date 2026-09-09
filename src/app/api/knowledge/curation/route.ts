import { publicKnowledgeCandidate } from "@/lib/knowledge-candidate-http";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { queueKnowledgeCuration, listKnowledgeCurationHistory } from "@/lib/knowledge-curation-service";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) { return authorization.response; }
  if (!queueKnowledgeCuration) {
    return Response.json({ error: "Knowledge extraction model and document worker must be configured for automatic curation." }, { status: 503 });
  }
  return Response.json(await queueKnowledgeCuration(authorization.access), { status: 202 });
}

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) { return authorization.response; }
  const sources = await listKnowledgeCurationHistory(authorization.access);
  return Response.json({ sources: sources.map((source) => ({ ...source, candidate: publicKnowledgeCandidate(source.candidate) })) });
}
