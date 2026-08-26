import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import {
  teamIdSchema,
  teamMemberSchema
} from "@/lib/organization-administration-schemas";
import { upsertTeamMemberRecord } from "@/lib/organization-administration-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; teamId: string }>;
}

export async function PUT(request: Request, context: RouteContext) {
  const params = await context.params;
  const organizationId = organizationIdSchema.safeParse(params.organizationId);
  const teamId = teamIdSchema.safeParse(params.teamId);
  if (!organizationId.success || !teamId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    organizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  const body = await readOrganizationJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = teamMemberSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid team member", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const member = await upsertTeamMemberRecord(
      authorization.access,
      teamId.data,
      parsed.data.email,
      parsed.data.role
    );
    return Response.json(member);
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
