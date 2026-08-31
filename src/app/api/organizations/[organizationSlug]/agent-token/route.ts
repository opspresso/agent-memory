import { organizationAgentTokenUseCases } from "@/lib/container";
import { organizationAgentTokenErrorResponse } from "@/lib/organization-agent-token-http";
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
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
  );
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
}

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
  );
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
}
