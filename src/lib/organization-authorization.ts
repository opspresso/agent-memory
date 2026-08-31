import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { organizationAgentTokenPrefix } from "@/domain/identity/organization-agent-token-repository";

import {
  organizationAccessRepository,
  organizationAgentTokenUseCases
} from "./container";
import { organizationSlugSchema } from "./organization-administration-schemas";
import { authenticateRequest, type SessionUser } from "./session";

export type OrganizationAuthorizationResult =
  | Readonly<{
      authorized: true;
      access: OrganizationAccess;
      user: SessionUser;
    }>
  | Readonly<{ authorized: false; response: Response }>;

export async function authorizeOrganizationRequest(
  request: Request,
  organizationSlug: string
): Promise<OrganizationAuthorizationResult> {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return { authorized: false, response: authentication.response };
  }

  const access = await organizationAccessRepository.findBySlug(
    organizationSlug,
    authentication.user.id
  );
  if (!access) {
    return {
      authorized: false,
      response: Response.json({ error: "Organization access denied" }, { status: 403 })
    };
  }

  return { authorized: true, access, user: authentication.user };
}

export async function authorizeOrganizationRoute(
  request: Request,
  organizationSlug: string
): Promise<OrganizationAuthorizationResult> {
  const parsed = organizationSlugSchema.safeParse(organizationSlug);
  if (!parsed.success) {
    return {
      authorized: false,
      response: Response.json(
        { error: "Invalid organization slug" },
        { status: 400 }
      )
    };
  }
  return authorizeOrganizationRequest(request, parsed.data);
}

export type OrganizationMcpAuthorizationResult =
  | Readonly<{ authorized: true; access: OrganizationAccess }>
  | Readonly<{ authorized: false; response: Response }>;

export async function authorizeOrganizationMcpRoute(
  request: Request,
  organizationSlug: string
): Promise<OrganizationMcpAuthorizationResult> {
  const parsed = organizationSlugSchema.safeParse(organizationSlug);
  if (!parsed.success) {
    return {
      authorized: false,
      response: Response.json(
        { error: "Invalid organization slug" },
        { status: 400 }
      )
    };
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? ""
  )?.[1];
  if (bearer?.startsWith(organizationAgentTokenPrefix)) {
    const access = await organizationAgentTokenUseCases.verify(
      parsed.data,
      bearer
    );
    return access
      ? { authorized: true, access }
      : {
          authorized: false,
          response: Response.json(
            { error: "Authentication required" },
            { status: 401 }
          )
        };
  }

  const authorization = await authorizeOrganizationRequest(request, parsed.data);
  return authorization.authorized
    ? { authorized: true, access: authorization.access }
    : authorization;
}
