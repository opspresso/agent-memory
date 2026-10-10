import { withRouteErrorBoundary } from "@/lib/route-error-boundary";
import { organizationAgentTokenUseCases } from "@/lib/container";
import { organizationAgentTokenErrorResponse } from "@/lib/organization-agent-token-http";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

export const POST = withRouteErrorBoundary("POST /api/agent-token/reveal", async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    return Response.json(
      await organizationAgentTokenUseCases.reveal(authorization.access),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const response = organizationAgentTokenErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
});
