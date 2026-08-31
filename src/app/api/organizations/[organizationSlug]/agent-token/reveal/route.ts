import { organizationAgentTokenUseCases } from "@/lib/container";
import { organizationAgentTokenErrorResponse } from "@/lib/organization-agent-token-http";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string }>;
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
}
