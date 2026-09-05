import {
  organizationAdministrationErrorResponse,
  publicOrganization,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import { createOrganizationSchema } from "@/lib/organization-administration-schemas";
import { createOrganizationRecord } from "@/lib/organization-administration-service";
import { listOrganizationMemberships } from "@/lib/organization-service";
import { authenticateRequest } from "@/lib/session";

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }

  const organizations = await listOrganizationMemberships(
    authentication.user.id
  );
  return Response.json({ organizations, count: organizations.length });
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  const body = await readOrganizationJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = createOrganizationSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid organization", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const organization = await createOrganizationRecord(
      { userId: authentication.user.id, isAdmin: authentication.user.isAdmin },
      parsed.data.slug,
      parsed.data.name
    );
    return Response.json(publicOrganization(organization, { canManage: true }), {
      status: 201
    });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
