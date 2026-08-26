import { z } from "zod";

import {
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

export const teamMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(teamRoles)
});
