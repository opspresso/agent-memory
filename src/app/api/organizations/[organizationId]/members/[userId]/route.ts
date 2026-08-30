import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import {
  memberUserIdSchema,
  updateOrganizationMemberSchema
} from "@/lib/organization-administration-schemas";
import {
  removeOrganizationMemberRecord,
  updateOrganizationMemberRecord
} from "@/lib/organization-administration-service";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; userId: string }>;
}

async function routeAccess(request: Request, context: RouteContext) {
  const params = await context.params;
  const userId = memberUserIdSchema.safeParse(params.userId);
  if (!userId.success) {
    return {
      authorized: false as const,
      response: Response.json({ error: "Invalid resource ID" }, { status: 400 })
    };
  }
  const authorization = await authorizeOrganizationRoute(
    request,
    params.organizationId
  );
  if (!authorization.authorized) {
    return authorization;
  }
  return { ...authorization, userId: userId.data };
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
  const parsed = updateOrganizationMemberSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid member update", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const member = await updateOrganizationMemberRecord(
      authorization.access,
      authorization.userId,
      parsed.data
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

export async function DELETE(request: Request, context: RouteContext) {
  const authorization = await routeAccess(request, context);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await removeOrganizationMemberRecord(
      authorization.access,
      authorization.userId
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
