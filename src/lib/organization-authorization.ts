import type { OrganizationAccess } from "@/domain/identity/organization-access";

import { organizationAccessRepository } from "./container";
import { organizationIdSchema } from "./memory-schemas";
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
  organizationId: string
): Promise<OrganizationAuthorizationResult> {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return { authorized: false, response: authentication.response };
  }

  const access = await organizationAccessRepository.findByUser(
    organizationId,
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
  organizationId: string
): Promise<OrganizationAuthorizationResult> {
  const parsed = organizationIdSchema.safeParse(organizationId);
  if (!parsed.success) {
    return {
      authorized: false,
      response: Response.json(
        { error: "Invalid organization ID" },
        { status: 400 }
      )
    };
  }
  return authorizeOrganizationRequest(request, parsed.data);
}
