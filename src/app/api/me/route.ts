import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
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
