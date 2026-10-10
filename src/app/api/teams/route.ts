import { withRouteErrorBoundary } from "@/lib/route-error-boundary";
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

export const GET = withRouteErrorBoundary("GET /api/teams", async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  const teams = await listTeamRecords(authorization.access);
  return Response.json({ teams, count: teams.length });
});

export const POST = withRouteErrorBoundary("POST /api/teams", async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
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
});
