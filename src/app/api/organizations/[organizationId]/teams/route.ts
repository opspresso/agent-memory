import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  organizationAdministrationErrorResponse,
  readOrganizationJsonBody
} from "@/lib/organization-administration-http";
import { createTeamSchema } from "@/lib/organization-administration-schemas";
import {
  createTeamRecord,
  listTeamRecords
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
  const teams = await listTeamRecords(authorization.access);
  return Response.json({ teams, count: teams.length });
}

export async function POST(request: Request, context: RouteContext) {
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
