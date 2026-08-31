import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  publicOrganization,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import { updateOrganizationSchema } from "@/lib/organization-administration-schemas";
import {
  deleteOrganizationRecord,
  getOrganizationRecord,
  updateOrganizationSettingsRecord
} from "@/lib/organization-administration-service";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    const organization = await getOrganizationRecord(authorization.access);
    const canManage =
      authorization.access.role === "admin" ||
      authorization.access.role === "owner";
    return Response.json(publicOrganization(organization, { canManage }));
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  const body = await readOrganizationJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = updateOrganizationSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid organization update", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const organization = await updateOrganizationSettingsRecord(
      authorization.access,
      parsed.data
    );
    return Response.json(publicOrganization(organization, { canManage: true }));
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await deleteOrganizationRecord(authorization.access);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
