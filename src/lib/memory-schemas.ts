import { z } from "zod";

import {
  memoryKinds,
  memoryPermissions,
  memorySourceTypes
} from "@/domain/memory/memory";

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (metadata) => JSON.stringify(metadata).length <= 32_768,
    "source metadata must not exceed 32 KiB"
  );

export const organizationIdSchema = z.uuid();
export const memoryIdSchema = z.uuid();

export const memorySourceSchema = z.object({
  type: z.enum(memorySourceTypes),
  uri: z.string().trim().min(1).max(2_048).optional(),
  agentId: z.string().trim().min(1).max(255).optional(),
  metadata: metadataSchema.optional()
});

export const memoryScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("organization") }),
  z.object({ kind: z.literal("team"), teamId: z.uuid() }),
  z.object({ kind: z.literal("user"), userId: z.uuid().optional() })
]);

export const memoryAccessGrantsSchema = z
  .array(
    z.discriminatedUnion("principalKind", [
      z.object({
        principalKind: z.literal("team"),
        teamId: z.uuid(),
        permission: z.enum(memoryPermissions)
      }),
      z.object({
        principalKind: z.literal("user"),
        userId: z.uuid(),
        permission: z.enum(memoryPermissions)
      })
    ])
  )
  .max(100)
  .refine(
    (grants) =>
      new Set(
        grants.map((grant) =>
          grant.principalKind === "team"
            ? `team:${grant.teamId}`
            : `user:${grant.userId}`
        )
      ).size === grants.length,
    "memory access grants must contain unique principals"
  );

export const createMemorySchema = z.object({
  kind: z.enum(memoryKinds),
  scope: memoryScopeSchema,
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(100_000),
  source: memorySourceSchema,
  accessGrants: memoryAccessGrantsSchema.optional(),
  validFrom: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional()
});

export const reviseMemorySchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    content: z.string().trim().min(1).max(100_000).optional(),
    source: memorySourceSchema.optional(),
    accessGrants: memoryAccessGrantsSchema.optional(),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    changeReason: z.string().trim().min(1).max(1_000).optional()
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.content !== undefined ||
      input.source !== undefined ||
      input.accessGrants !== undefined ||
      input.expiresAt !== undefined,
    "at least one memory field must be revised"
  );

export const memoryVersionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().min(2).optional()
});
