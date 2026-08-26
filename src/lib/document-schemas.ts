import { z } from "zod";

import { documentMimeTypes } from "@/domain/document/document";

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (metadata) => JSON.stringify(metadata).length <= 32_768,
    "document metadata must not exceed 32 KiB"
  );

export const documentIdSchema = z.uuid();

export const documentUploadFieldsSchema = z
  .object({
    scopeKind: z.enum(["organization", "team", "user"]),
    teamId: z.uuid().optional(),
    userId: z.uuid().optional(),
    title: z.string().trim().min(1).max(500),
    sourceUri: z.string().trim().min(1).max(2_048).optional(),
    mimeType: z.enum(documentMimeTypes),
    metadata: metadataSchema.optional()
  })
  .superRefine((input, context) => {
    if (input.scopeKind === "team" && !input.teamId) {
      context.addIssue({
        code: "custom",
        message: "teamId is required for team scope",
        path: ["teamId"]
      });
    }
    if (input.scopeKind !== "team" && input.teamId) {
      context.addIssue({
        code: "custom",
        message: "teamId is only allowed for team scope",
        path: ["teamId"]
      });
    }
    if (input.scopeKind !== "user" && input.userId) {
      context.addIssue({
        code: "custom",
        message: "userId is only allowed for user scope",
        path: ["userId"]
      });
    }
  });
