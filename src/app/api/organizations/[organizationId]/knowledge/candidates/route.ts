import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  knowledgeCandidateErrorResponse,
  publicKnowledgeCandidate
} from "@/lib/knowledge-candidate-http";
import { listKnowledgeCandidateRecords } from "@/lib/knowledge-candidate-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return Response.json({ error: "Invalid organization ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
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
      total: candidates.length
    });
  } catch (error) {
    const response = knowledgeCandidateErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
