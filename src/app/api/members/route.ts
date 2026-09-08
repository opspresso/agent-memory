import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import { organizationMemberSchema } from "@/lib/organization-administration-schemas";
import {
  addOrganizationMemberRecord,
  listOrganizationMemberRecords
} from "@/lib/organization-administration-service";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    const members = await listOrganizationMemberRecords(authorization.access);
    return Response.json({ members, count: members.length });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  const body = await readOrganizationJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = organizationMemberSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid organization member", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const member = await addOrganizationMemberRecord(
      authorization.access,
      parsed.data.email,
      parsed.data.role
    );
    return Response.json(member, { status: 201 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
