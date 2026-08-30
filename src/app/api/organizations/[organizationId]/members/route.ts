import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import { organizationMemberSchema } from "@/lib/organization-administration-schemas";
import {
  listOrganizationMemberRecords,
  upsertOrganizationMemberRecord
} from "@/lib/organization-administration-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

async function routeAccess(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsed = organizationIdSchema.safeParse(organizationId);
  if (!parsed.success) {
    return {
      authorized: false as const,
      response: Response.json(
        { error: "Invalid organization ID" },
        { status: 400 }
      )
    };
  }
  return authorizeOrganizationRequest(request, parsed.data);
}

export async function GET(request: Request, context: RouteContext) {
  const authorization = await routeAccess(request, context);
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

export async function PUT(request: Request, context: RouteContext) {
  const authorization = await routeAccess(request, context);
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
    const member = await upsertOrganizationMemberRecord(
      authorization.access,
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
