import { z } from "zod";

import { memoryScopeSchema } from "./memory-schemas";

const propertiesSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (properties) => JSON.stringify(properties).length <= 32_768,
    "knowledge properties must not exceed 32 KiB"
  );

const knowledgeSourceSchema = z
  .object({
    memoryId: z.uuid().optional(),
    chunkId: z.uuid().optional()
  })
  .refine(
    (source) =>
      Number(source.memoryId !== undefined) +
        Number(source.chunkId !== undefined) ===
      1,
    "knowledge source must reference exactly one memory or document chunk"
  );

export const knowledgeNodeIdSchema = z.uuid();
export const knowledgeEdgeIdSchema = z.uuid();
export const knowledgeCandidateIdSchema = z.uuid();

export const reviewKnowledgeCandidateSchema = z.object({
  reason: z.string().trim().min(1).max(2_000).optional()
});

export const createKnowledgeNodeSchema = z.object({
  scope: memoryScopeSchema,
  kind: z.string().trim().min(1).max(100),
  canonicalName: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(10_000).optional(),
  properties: propertiesSchema.optional(),
  source: knowledgeSourceSchema
});

export const createKnowledgeEdgeSchema = z.object({
  scope: memoryScopeSchema,
  sourceNodeId: z.uuid(),
  targetNodeId: z.uuid(),
  predicate: z.string().trim().min(1).max(100),
  properties: propertiesSchema.optional(),
  source: knowledgeSourceSchema
});
