import {
  defaultKnowledgeOntology,
  defaultKnowledgeOntologyMode,
  type KnowledgeOntology,
  type KnowledgeOntologyMode
} from "../knowledge/knowledge-ontology";
import type {
  OrganizationMemberStatus,
  OrganizationRole,
  TeamRole
} from "./organization-access";

export interface Organization {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly defaultTeamId: string | null;
  readonly ontologyMode: KnowledgeOntologyMode;
  readonly ontology: KnowledgeOntology;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OrganizationMember {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly status: OrganizationMemberStatus;
  readonly createdAt: Date;
}

export interface Team {
  readonly id: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TeamMember {
  readonly teamId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: TeamRole;
  readonly createdAt: Date;
}

export interface NewOrganization {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly now: Date;
}

export interface NewTeam {
  readonly id: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
  readonly now: Date;
}

export class InvalidOrganizationAdministrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrganizationAdministrationError";
  }
}

function normalizedSlug(slug: string): string {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 63) {
    throw new InvalidOrganizationAdministrationError(
      "slug must contain lowercase letters, numbers, and single hyphens"
    );
  }
  return value;
}

function normalizedName(name: string): string {
  const value = name.trim();
  if (value.length === 0 || value.length > 200) {
    throw new InvalidOrganizationAdministrationError(
      "name must contain between 1 and 200 characters"
    );
  }
  return value;
}

export function createOrganization(input: NewOrganization): Organization {
  return Object.freeze({
    id: input.id,
    slug: normalizedSlug(input.slug),
    name: normalizedName(input.name),
    defaultTeamId: null,
    ontologyMode: defaultKnowledgeOntologyMode,
    ontology: defaultKnowledgeOntology,
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now)
  });
}

export function normalizedOrganizationName(name: string): string {
  return normalizedName(name);
}

export function createTeam(input: NewTeam): Team {
  return Object.freeze({
    id: input.id,
    organizationId: input.organizationId,
    slug: normalizedSlug(input.slug),
    name: normalizedName(input.name),
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now)
  });
}
