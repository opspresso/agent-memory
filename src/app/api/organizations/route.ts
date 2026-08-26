import {
  organizationAdministrationErrorResponse,
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
  return Response.json({ organizations, total: organizations.length });
}

export async function POST(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!authentication.user.isAdmin) {
    return Response.json(
      { error: "Only configured admins can create organizations" },
      { status: 403 }
    );
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
      authentication.user.id,
      parsed.data.slug,
      parsed.data.name
    );
    return Response.json(organization, { status: 201 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
