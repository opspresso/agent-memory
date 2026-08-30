import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import { knowledgeCandidateErrorResponse } from "@/lib/knowledge-candidate-http";
import { findKnowledgeCandidateDuplicateRecords } from "@/lib/knowledge-candidate-service";
import { publicKnowledgeNode } from "@/lib/knowledge-http";
import { knowledgeCandidateIdSchema } from "@/lib/knowledge-schemas";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; candidateId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId, candidateId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  const parsedCandidateId = knowledgeCandidateIdSchema.safeParse(candidateId);
  if (!parsedOrganizationId.success || !parsedCandidateId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    const result = await findKnowledgeCandidateDuplicateRecords(
      authorization.access,
      parsedCandidateId.data
    );
    return Response.json({
      duplicates: Object.fromEntries(
        Object.entries(result.duplicates).map(([key, nodes]) => [
          key,
          nodes.map(publicKnowledgeNode)
        ])
      ),
      ontology: result.ontology
    });
  } catch (error) {
    const response = knowledgeCandidateErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
