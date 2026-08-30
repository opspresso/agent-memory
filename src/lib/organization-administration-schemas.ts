import { z } from "zod";

import {
  newMemberStatuses,
  organizationMemberStatuses,
  organizationRoles,
  teamRoles
} from "@/domain/identity/organization-access";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createOrganizationSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(200)
});

export const organizationMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(organizationRoles)
});

export const createTeamSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(200)
});

export const teamIdSchema = z.uuid();

export const memberUserIdSchema = z.uuid();

export const teamMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(teamRoles)
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    newMemberStatus: z.enum(newMemberStatuses).optional(),
    defaultTeamId: z.uuid().nullable().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.newMemberStatus !== undefined ||
      value.defaultTeamId !== undefined,
    { message: "at least one field is required" }
  );

export const updateOrganizationMemberSchema = z
  .object({
    role: z.enum(organizationRoles).optional(),
    status: z.enum(organizationMemberStatuses).optional()
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "at least one field is required"
  });

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(200)
});
