import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { knowledgeProcessingProgress, knowledgeProcessingEnabled } from "@/lib/knowledge-curation-service";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) { return authorization.response; }
  return Response.json({ ...await knowledgeProcessingProgress(authorization.access), enabled: knowledgeProcessingEnabled }, { headers: { "Cache-Control": "no-store" } });
}
