import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

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

  return Response.json({
    organizationId: authorization.access.organizationId,
    role: authorization.access.role,
    teams: authorization.access.teams,
    user: authorization.user
  });
}
