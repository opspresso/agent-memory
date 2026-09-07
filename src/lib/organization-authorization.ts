import { z } from "zod";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { organizationAgentTokenPrefix } from "@/domain/identity/organization-agent-token-repository";

import {
  organizationAccessRepository,
  organizationAgentTokenUseCases
} from "./container";
import { installationRepository } from "./installation";
import { authenticateRequest, type SessionUser } from "./session";

export type OrganizationAuthorizationResult =
  | Readonly<{
      authorized: true;
      access: OrganizationAccess;
      user: SessionUser;
    }>
  | Readonly<{ authorized: false; response: Response }>;

export async function authorizeOrganizationRoute(
  request: Request
): Promise<OrganizationAuthorizationResult> {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return { authorized: false, response: authentication.response };
  }

  const organization = await installationRepository.get();
  const access = await organizationAccessRepository.findBySlug(
    organization.slug,
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

export type OrganizationMcpAuthorizationResult =
  | Readonly<{ authorized: true; access: OrganizationAccess }>
  | Readonly<{ authorized: false; response: Response }>;

export async function authorizeOrganizationMcpRoute(request: Request): Promise<OrganizationMcpAuthorizationResult> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? ""
  )?.[1];
  if (bearer?.startsWith(organizationAgentTokenPrefix)) {
    const organization = await installationRepository.get();
    const credential = await organizationAgentTokenUseCases.verify(
      organization.slug,
      bearer
    );
    if (!credential) {
      return {
        authorized: false,
        response: Response.json(
          { error: "Authentication required" },
          { status: 401 }
        )
      };
    }

    const delegatedEmail = request.headers.get("x-user-email");
    if (delegatedEmail !== null) {
      const email = z.email().safeParse(delegatedEmail.trim().toLowerCase());
      if (!email.success) {
        return {
          authorized: false,
          response: Response.json(
            { error: "Invalid delegated user email" },
            { status: 400 }
          )
        };
      }

      const access = await organizationAccessRepository.findByEmail(
        credential.organizationId,
        email.data
      );
      if (!access) {
        return {
          authorized: false,
          response: Response.json(
            { error: "Organization access denied" },
            { status: 403 }
          )
        };
      }
      return { authorized: true, access };
    }

    return {
      authorized: true,
      access: {
        organizationId: credential.organizationId,
        userId: credential.userId,
        role: credential.role,
        teams: [],
        principalKind: "organization-agent"
      }
    };
  }

  const authorization = await authorizeOrganizationRoute(request);
  return authorization.authorized
    ? { authorized: true, access: authorization.access }
    : authorization;
}
