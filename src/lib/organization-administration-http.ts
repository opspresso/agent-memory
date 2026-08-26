import {
  OrganizationAdministrationAccessDeniedError,
  OrganizationMemberNotFoundError,
  OrganizationOwnerImmutableError,
  OrganizationSlugConflictError,
  TeamNotFoundError,
  TeamSlugConflictError
} from "@/application/identity/manage-organization";
import { InvalidOrganizationAdministrationError } from "@/domain/identity/organization-administration";

export function organizationAdministrationErrorResponse(
  error: unknown
): Response | null {
  if (error instanceof OrganizationAdministrationAccessDeniedError) {
    return Response.json(
      { error: "Organization administration access denied" },
      { status: 403 }
    );
  }
  if (
    error instanceof OrganizationSlugConflictError ||
    error instanceof TeamSlugConflictError ||
    error instanceof OrganizationOwnerImmutableError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof OrganizationMemberNotFoundError ||
    error instanceof TeamNotFoundError
  ) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof InvalidOrganizationAdministrationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
}

export async function readOrganizationJsonBody(
  request: Request
): Promise<
  | Readonly<{ valid: true; value: unknown }>
  | Readonly<{ valid: false; response: Response }>
> {
  try {
    return { valid: true, value: await request.json() };
  } catch {
    return {
      valid: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 })
    };
  }
}
