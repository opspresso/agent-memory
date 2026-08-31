import {
  OrganizationAgentTokenAccessDeniedError,
  OrganizationAgentTokenNotFoundError,
  OrganizationAgentTokenNotRevealableError
} from "@/application/identity/manage-organization-agent-token";

export function organizationAgentTokenErrorResponse(
  error: unknown
): Response | undefined {
  if (error instanceof OrganizationAgentTokenAccessDeniedError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof OrganizationAgentTokenNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof OrganizationAgentTokenNotRevealableError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return undefined;
}
