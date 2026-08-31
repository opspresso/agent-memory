import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  knowledgeCandidateErrorResponse,
  publicKnowledgeCandidatePromotion
} from "@/lib/knowledge-candidate-http";
import { acceptKnowledgeCandidateRecord } from "@/lib/knowledge-candidate-service";
import {
  knowledgeCandidateIdSchema,
  reviewKnowledgeCandidateSchema
} from "@/lib/knowledge-schemas";
import { readJsonBody } from "@/lib/memory-http";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; candidateId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId, candidateId } = await context.params;
  const parsedCandidateId = knowledgeCandidateIdSchema.safeParse(candidateId);
  if (!parsedCandidateId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  const body = await readJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = reviewKnowledgeCandidateSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid knowledge candidate review", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const result = await acceptKnowledgeCandidateRecord(
      authorization.access,
      parsedCandidateId.data,
      parsed.data.reason
    );
    return Response.json(publicKnowledgeCandidatePromotion(result));
  } catch (error) {
    const response = knowledgeCandidateErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
