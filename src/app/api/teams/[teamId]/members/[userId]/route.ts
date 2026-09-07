import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { organizationAdministrationErrorResponse } from "@/lib/organization-administration-http";
import {
  memberUserIdSchema,
  teamIdSchema
} from "@/lib/organization-administration-schemas";
import { removeTeamMemberRecord } from "@/lib/organization-administration-service";

interface RouteContext {
  readonly params: Promise<{
    teamId: string;
    userId: string;
  }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  const params = await context.params;
  const teamId = teamIdSchema.safeParse(params.teamId);
  const userId = memberUserIdSchema.safeParse(params.userId);
  if (!teamId.success || !userId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRoute(request);
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
