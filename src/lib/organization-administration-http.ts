import {
  AlreadyOrganizationMemberError,
  OrganizationAdministrationAccessDeniedError,
  OrganizationMemberNotFoundError,
  OrganizationNotFoundError,
  OrganizationOwnerImmutableError,
  OrganizationSelfManagementError,
  TeamNotFoundError,
  TeamSlugConflictError
} from "@/application/identity/manage-organization";
import {
  InvalidOrganizationAdministrationError,
  type Organization
} from "@/domain/identity/organization-administration";
import { InvalidKnowledgeOntologyError } from "@/domain/knowledge/knowledge-ontology";

export { readJsonBody as readOrganizationJsonBody } from "./json-body";

export function publicOrganization(
  organization: Organization,
  options: Readonly<{ canManage: boolean }>
) {
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    ...(options.canManage
      ? {
          newMemberStatus: organization.newMemberStatus,
          defaultTeamId: organization.defaultTeamId,
          ontologyMode: organization.ontologyMode,
          ontology: organization.ontology
        }
      : {}),
    createdAt: organization.createdAt
  };
}

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
  if (
    error instanceof InvalidOrganizationAdministrationError ||
    error instanceof InvalidKnowledgeOntologyError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
}
