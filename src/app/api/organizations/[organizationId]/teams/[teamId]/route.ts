import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import {
  teamIdSchema,
  updateTeamSchema
} from "@/lib/organization-administration-schemas";
import {
  deleteTeamRecord,
  updateTeamRecord
} from "@/lib/organization-administration-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; teamId: string }>;
}

async function routeAccess(request: Request, context: RouteContext) {
  const params = await context.params;
  const organizationId = organizationIdSchema.safeParse(params.organizationId);
  const teamId = teamIdSchema.safeParse(params.teamId);
  if (!organizationId.success || !teamId.success) {
    return {
      authorized: false as const,
      response: Response.json({ error: "Invalid resource ID" }, { status: 400 })
    };
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    organizationId.data
  );
  if (!authorization.authorized) {
    return authorization;
  }
  return { ...authorization, teamId: teamId.data };
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await routeAccess(request, context);
  if (!authorization.authorized) {
    return authorization.response;
  }
  const body = await readOrganizationJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = updateTeamSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid team update", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const team = await updateTeamRecord(
      authorization.access,
      authorization.teamId,
      parsed.data.name
    );
    return Response.json(team);
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = await routeAccess(request, context);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await deleteTeamRecord(authorization.access, authorization.teamId);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
