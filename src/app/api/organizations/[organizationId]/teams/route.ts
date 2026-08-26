import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import { createTeamSchema } from "@/lib/organization-administration-schemas";
import {
  createTeamRecord,
  listTeamRecords
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
  const teams = await listTeamRecords(authorization.access);
  return Response.json({ teams, total: teams.length });
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await routeAccess(request, context);
  if (!authorization.authorized) {
    return authorization.response;
  }
  const body = await readOrganizationJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = createTeamSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid team", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const team = await createTeamRecord(
      authorization.access,
      parsed.data.slug,
      parsed.data.name
    );
    return Response.json(team, { status: 201 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
