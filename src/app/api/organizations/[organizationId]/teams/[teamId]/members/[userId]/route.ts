import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import { organizationAdministrationErrorResponse } from "@/lib/organization-administration-http";
import {
  memberUserIdSchema,
  teamIdSchema
} from "@/lib/organization-administration-schemas";
import { removeTeamMemberRecord } from "@/lib/organization-administration-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{
    organizationId: string;
    teamId: string;
    userId: string;
  }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  const params = await context.params;
  const organizationId = organizationIdSchema.safeParse(params.organizationId);
  const teamId = teamIdSchema.safeParse(params.teamId);
  const userId = memberUserIdSchema.safeParse(params.userId);
  if (!organizationId.success || !teamId.success || !userId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    organizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await removeTeamMemberRecord(
      authorization.access,
      teamId.data,
      userId.data
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
