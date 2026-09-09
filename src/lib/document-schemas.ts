import { z } from "zod";

import { documentMimeTypes } from "@/domain/document/document";
import { serializedJsonByteLength } from "@/domain/shared/json-size";
import { memoryScopeSchema } from "./memory-schemas";
import { maxDocumentBytes } from "./document-http";

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (metadata) => serializedJsonByteLength(metadata) <= 32_768,
    "document metadata must not exceed 32 KiB"
  );

export const documentIngestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(256),
  scope: memoryScopeSchema,
  title: z.string().trim().min(1).max(500),
  mimeType: z.enum(documentMimeTypes),
  content: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= maxDocumentBytes, "document exceeds 10 MiB"),
  sourceUri: z.string().trim().min(1).max(2048).optional(),
  metadata: metadataSchema.optional()
});

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
