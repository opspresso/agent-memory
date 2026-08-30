import {
  AlreadyOrganizationMemberError,
  OrganizationAdministrationAccessDeniedError,
  OrganizationMemberNotFoundError,
  OrganizationNotFoundError,
  OrganizationOwnerImmutableError,
  OrganizationSelfManagementError,
  OrganizationSlugConflictError,
  TeamNotFoundError,
  TeamSlugConflictError
} from "@/application/identity/manage-organization";
import { InvalidOrganizationAdministrationError } from "@/domain/identity/organization-administration";

export { readJsonBody as readOrganizationJsonBody } from "./json-body";

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
    error instanceof OrganizationOwnerImmutableError ||
    error instanceof OrganizationSelfManagementError ||
    error instanceof AlreadyOrganizationMemberError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof OrganizationNotFoundError ||
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
