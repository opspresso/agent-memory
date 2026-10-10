import { withRouteErrorBoundary } from "@/lib/route-error-boundary";
import { organizationAgentTokenUseCases } from "@/lib/container";
import { organizationAgentTokenErrorResponse } from "@/lib/organization-agent-token-http";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

export const GET = withRouteErrorBoundary("GET /api/agent-token", async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    return Response.json(
      await organizationAgentTokenUseCases.status(authorization.access),
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

export const POST = withRouteErrorBoundary("POST /api/agent-token", async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    return Response.json(
      await organizationAgentTokenUseCases.generate(authorization.access),
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const response = organizationAgentTokenErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
});

export const DELETE = withRouteErrorBoundary("DELETE /api/agent-token", async function DELETE(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await organizationAgentTokenUseCases.revoke(authorization.access);
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = organizationAgentTokenErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
});
