import { z } from "zod";

import {
  newMemberStatuses,
  manageableOrganizationMemberStatuses,
  organizationRoles,
  teamRoles
} from "@/domain/identity/organization-access";
import { knowledgeOntologyModes } from "@/domain/knowledge/knowledge-ontology";

export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createOrganizationSchema = z.object({
  slug: organizationSlugSchema,
  name: z.string().trim().min(1).max(200)
});

export const organizationMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(organizationRoles)
});

export const createTeamSchema = z.object({
  slug: organizationSlugSchema,
  name: z.string().trim().min(1).max(200)
});

export const teamIdSchema = z.uuid();

export const memberUserIdSchema = z.uuid();

export const teamMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(teamRoles)
});

const ontologyTermSchema = z.string().trim().min(1).max(100);

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    newMemberStatus: z.enum(newMemberStatuses).optional(),
    defaultTeamId: z.uuid().nullable().optional(),
    ontologyMode: z.enum(knowledgeOntologyModes).optional(),
    ontology: z
      .object({
        nodeKinds: z.array(ontologyTermSchema).max(200),
        edgePredicates: z.array(ontologyTermSchema).max(200)
      })
      .optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.newMemberStatus !== undefined ||
      value.defaultTeamId !== undefined ||
      value.ontologyMode !== undefined ||
      value.ontology !== undefined,
    { message: "at least one field is required" }
  );

export const updateOrganizationMemberSchema = z
  .object({
    role: z.enum(organizationRoles).optional(),
    status: z.enum(manageableOrganizationMemberStatuses).optional()
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "at least one field is required"
  });

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(200)
});
