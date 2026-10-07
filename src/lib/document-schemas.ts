import { z } from "zod";

import { documentMimeTypes, isDocumentTextMimeType } from "@/domain/document/document-format";
import { serializedJsonByteLength } from "@/domain/shared/json-size";
import { memoryScopeSchema } from "./memory-schemas";
import { maxDocumentBytes } from "@/domain/document/document";

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (metadata) => serializedJsonByteLength(metadata) <= 32_768,
    "document metadata must not exceed 32 KiB"
  );

// Validate without allocating decoded buffers; the accepted payload is decoded once by the MCP boundary.
function base64ByteLength(content: string): number | undefined {
  if (content.length % 4 !== 0) return undefined;
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  const payload = content.slice(0, content.length - padding);
  if (/[^A-Za-z0-9+/]/.test(payload)) return undefined;
  if (padding) {
    const last = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(payload.at(-1) ?? "=");
    // Unused low bits must be zero; Buffer.from alone accepts noncanonical tails.
    if (last < 0 || (last & (padding === 2 ? 15 : 3)) !== 0) return undefined;
  }
  return content.length / 4 * 3 - padding;
}

export const documentIngestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(256),
  scope: memoryScopeSchema,
  title: z.string().trim().min(1).max(500),
  mimeType: z.enum(documentMimeTypes),
  contentEncoding: z.enum(["utf8", "base64"]).default("utf8"),
  content: z.string().min(1).max(Math.ceil(maxDocumentBytes / 3) * 4),
  sourceUri: z.string().trim().min(1).max(2048).optional(),
  metadata: metadataSchema.optional()
}).superRefine((input, context) => {
  if (input.contentEncoding === "utf8") {
    if (!isDocumentTextMimeType(input.mimeType) && input.mimeType !== "text/html") {
      context.addIssue({ code: "custom", path: ["contentEncoding"], message: "binary documents require base64 encoding" });
    }
    if (Buffer.byteLength(input.content, "utf8") > maxDocumentBytes) {
      context.addIssue({ code: "custom", path: ["content"], message: "document exceeds 10 MiB" });
    }
  } else {
    const byteLength = base64ByteLength(input.content);
    if (byteLength === undefined) {
      context.addIssue({ code: "custom", path: ["content"], message: "document content must be canonical base64" });
    } else if (byteLength > maxDocumentBytes) {
      context.addIssue({ code: "custom", path: ["content"], message: "document exceeds 10 MiB" });
    }
  }
});

export const documentIdSchema = z.uuid();

export const changeDocumentScopeSchema = z.strictObject({
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("organization") }),
    z.strictObject({ kind: z.literal("team"), teamId: z.uuid() }),
    z.strictObject({ kind: z.literal("user") })
  ])
});

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
