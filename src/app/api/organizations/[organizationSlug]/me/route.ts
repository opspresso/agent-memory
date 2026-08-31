import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
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
