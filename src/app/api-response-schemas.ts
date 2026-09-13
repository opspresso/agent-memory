import { z } from "zod";
import { knowledgeScopeSkipReasons } from "@/domain/document/document-scope-change";

import {
  manageableOrganizationMemberStatuses,
  organizationRoles,
  teamRoles
} from "@/domain/identity/organization-access";
import { knowledgeOntologyModes } from "@/domain/knowledge/knowledge-ontology";

export const scopeResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("organization"), organizationId: z.string().min(1) }),
  z.object({
    kind: z.literal("team"),
    organizationId: z.string().min(1),
    teamId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("user"),
    organizationId: z.string().min(1),
    userId: z.string().min(1)
  })
]);

export const organizationSummaryResponseSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1)
});

export const teamResponseSchema = organizationSummaryResponseSchema;

export const organizationMemberResponseSchema = z.object({
  userId: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(organizationRoles),
  status: z.enum(manageableOrganizationMemberStatuses)
});

export const teamMemberResponseSchema = z.object({
  teamId: z.string().min(1),
  userId: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(teamRoles)
});

export const organizationMembersResponseSchema = z.object({
  members: z.array(organizationMemberResponseSchema)
});

export const teamsResponseSchema = z.object({
  teams: z.array(teamResponseSchema)
});

export const teamMembersResponseSchema = z.object({
  members: z.array(teamMemberResponseSchema)
});

export const organizationAccessResponseSchema = z.object({
  organizationId: z.string().min(1),
  role: z.enum(organizationRoles),
  teams: z.array(
    z.object({ teamId: z.string().min(1), role: z.enum(teamRoles) })
  ),
  user: z.object({ id: z.string().min(1) })
});

export const authenticationRedirectResponseSchema = z.object({
  url: z.url()
});

export const agentTokenStatusResponseSchema = z.object({
  configured: z.boolean(),
  masked: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  revealable: z.boolean().optional()
});

export const generatedAgentTokenResponseSchema = z.object({
  token: z.string().min(1),
  masked: z.string().min(1),
  createdAt: z.string().min(1)
});

export const revealedAgentTokenResponseSchema = z.object({
  token: z.string().min(1),
  createdAt: z.string().min(1)
});

export const ontologyResponseSchema = z.object({
  nodeKinds: z.array(z.string()),
  edgePredicates: z.array(z.string())
});

export const organizationDetailResponseSchema = organizationSummaryResponseSchema.extend({
  defaultTeamId: z.string().nullable().optional(),
  ontologyMode: z.enum(knowledgeOntologyModes).optional(),
  ontology: ontologyResponseSchema.optional()
});

export const ontologyRecommendationResponseSchema = z.object({
  nodeKinds: z.array(z.object({ term: z.string(), count: z.number().int() })),
  edgePredicates: z.array(
    z.object({ term: z.string(), count: z.number().int() })
  )
});

export const documentUploadResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "processing", "ready", "failed", "archived"])
});

const memorySourceResponseSchema = z.object({
  type: z.string().min(1),
  uri: z.string().optional(),
  agentId: z.string().optional()
});

export const memoryDetailResponseSchema = z.object({
  id: z.string().min(1),
  scope: scopeResponseSchema.optional(),
  kind: z.string().min(1),
  title: z.string(),
  content: z.string(),
  source: memorySourceResponseSchema,
  status: z.enum(["active", "archived"]),
  version: z.number().int().positive(),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  validFrom: z.string().min(1),
  expiresAt: z.string().optional(),
  capabilities: z.object({ write: z.boolean(), manage: z.boolean() })
});

export const memoryLibraryResponseSchema = z.object({
  memories: z.array(memoryDetailResponseSchema.extend({ scope: scopeResponseSchema })),
  count: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable()
});

export const documentDetailResponseSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  scope: scopeResponseSchema,
  mimeType: z.string(),
  sizeBytes: z.number().nonnegative(),
  status: z.enum(["pending", "processing", "ready", "failed", "archived"]),
  sourceUri: z.string().optional(),
  processingError: z.string().optional(),
  processingAttempts: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const documentLibraryResponseSchema = z.object({
  documents: z.array(documentDetailResponseSchema),
  count: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable()
});

const scopeChangeCountsSchema = z.object({ updated: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });
export const documentScopeRestrictionResponseSchema = z.object({ code: z.literal("related_scope_conflict") });
export const documentScopeChangeResponseSchema = z.object({
  document: documentDetailResponseSchema,
  knowledge: z.object({
    nodes: scopeChangeCountsSchema,
    edges: scopeChangeCountsSchema,
    skipped: z.array(z.object({ resource: z.enum(["node", "edge"]), reason: z.enum(knowledgeScopeSkipReasons), count: z.number().int().positive() }))
  })
});

export const documentContentsResponseSchema = z.object({
  document: documentDetailResponseSchema,
  chunks: z.array(z.object({
    id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown())
  })),
  count: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable()
});

export const documentChunkDetailResponseSchema = z.object({
  document: documentDetailResponseSchema,
  chunk: z.object({
    id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    content: z.string()
  })
});

export const memoryVersionResponseSchema = z.object({
  memoryId: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  source: memorySourceResponseSchema,
  status: z.enum(["active", "archived"]),
  changedBy: z.string().min(1),
  changeReason: z.string().optional(),
  createdAt: z.string().min(1)
});

export const memoryVersionsResponseSchema = z.object({
  versions: z.array(memoryVersionResponseSchema)
});

const knowledgeSourceResponseSchema = z.union([
  z.object({ memoryId: z.string().min(1) }),
  z.object({ chunkId: z.string().min(1) })
]);

export const knowledgeNodeResponseSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  summary: z.string().optional(),
  scope: scopeResponseSchema,
  sources: z.array(knowledgeSourceResponseSchema).optional()
});

export const knowledgeEdgeResponseSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  predicate: z.string().min(1),
  scope: scopeResponseSchema,
  sources: z.array(knowledgeSourceResponseSchema).optional()
});

const memorySearchResourceSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  scope: scopeResponseSchema,
  source: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().optional(),
  capabilities: z
    .object({ write: z.boolean(), manage: z.boolean() })
    .optional()
});

const documentSearchResourceSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  mimeType: z.string().optional(),
  scope: scopeResponseSchema
});

const documentChunkResponseSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  content: z.string()
});

export const searchHitResponseSchema = z
  .object({
    sourceType: z.enum(["memory", "document", "knowledge"]).optional(),
    memory: memorySearchResourceSchema.optional(),
    document: documentSearchResourceSchema.optional(),
    chunk: documentChunkResponseSchema.optional(),
    node: knowledgeNodeResponseSchema.optional(),
    lexicalScore: z.number().finite().optional(),
    vectorScore: z.number().finite().optional(),
    score: z.number().finite().optional()
  })
  .passthrough()
  .refine((hit) => hit.memory || hit.document || hit.node);

export const searchResponseSchema = z.object({
  hits: z.array(searchHitResponseSchema)
});

export const neighborhoodResponseSchema = z.object({
  nodes: z.array(knowledgeNodeResponseSchema),
  edges: z.array(knowledgeEdgeResponseSchema)
});

const proposedEntityResponseSchema = z.object({
  aliases: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  key: z.string().min(1),
  kind: z.string().min(1),
  canonicalName: z.string().min(1),
  summary: z.string().optional()
});

const proposedRelationshipResponseSchema = z.object({
  evidence: z.array(z.string()).optional(),
  sourceKey: z.string().min(1),
  targetKey: z.string().min(1),
  predicate: z.string().min(1)
});

export const knowledgeCandidateResponseSchema = z.object({
  assessment: z.object({ model: z.string(), policyVersion: z.string(), assessedAt: z.string(),
    aliases: z.array(z.object({ entityKey: z.string(), alias: z.string(),
      identity: z.enum(["same_entity", "generic_reference", "different_entity", "uncertain"]),
      verdict: z.enum(["accept", "review", "ignore"]), evidence: z.string(), reason: z.string() })).optional(),
    items: z.array(z.object({ item: z.string(), verdict: z.enum(["accept", "review", "ignore"]), evidence: z.string(), reason: z.string() })) }).optional(),
  itemReviews: z.array(z.object({ item: z.string(), decision: z.enum(["accepted", "rejected"]),
    reviewedAt: z.string(), reviewedBy: z.string(), method: z.enum(["human", "automatic"]).optional(), reason: z.string().optional() })).optional(),
  id: z.string().min(1),
  documentId: z.string().min(1),
  chunkId: z.string().min(1),
  model: z.string().min(1),
  scope: scopeResponseSchema,
  graph: z.object({
    entities: z.array(proposedEntityResponseSchema),
    relationships: z.array(proposedRelationshipResponseSchema)
  }),
  createdAt: z.string().min(1)
});

export const knowledgeCandidatesResponseSchema = z.object({
  candidates: z.array(knowledgeCandidateResponseSchema)
});

export const ontologyFlagsResponseSchema = z.object({
  mode: z.enum(knowledgeOntologyModes),
  violations: z.array(
    z.object({
      type: z.enum(["unknown_kind", "unknown_predicate"]),
      term: z.string().min(1)
    })
  )
});

export const candidateDuplicatesResponseSchema = z.object({
  duplicates: z.record(
    z.string(),
    z.array(knowledgeNodeResponseSchema)
  ).optional(),
  ontology: ontologyFlagsResponseSchema.optional()
});

export const knowledgeReviewGroupsResponseSchema = z.object({
  automaticAccepted: z.number().int().nonnegative(),
  automaticIgnored: z.number().int().nonnegative(),
  unassessedCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  groups: z.array(z.object({
    key: z.string(), title: z.string(), kind: z.enum(["entity", "relationship"]),
    predicate: z.string().optional(), entityKind: z.string().optional(),
    scope: scopeResponseSchema, weak: z.boolean(), evidenceCount: z.number(), documentCount: z.number(),
    ontology: ontologyFlagsResponseSchema,
    occurrences: z.array(z.object({
      candidateId: z.string(), documentId: z.string(), documentTitle: z.string(), chunkId: z.string(), ordinal: z.number(),
      selection: z.object({ entityKeys: z.array(z.string()), relationshipIndexes: z.array(z.number().int()) }),
      evidence: z.array(z.string()), aliases: z.array(z.string()), summary: z.string().optional(),
      assessmentReason: z.string().optional()
    })).min(1)
  }))
});

export type KnowledgeReviewGroupsResponse = z.infer<typeof knowledgeReviewGroupsResponseSchema>;

export const knowledgeCurationHistoryResponseSchema = z.object({ sources: z.array(z.object({
  candidate: knowledgeCandidateResponseSchema, documentTitle: z.string(), ordinal: z.number()
})) });

export type SearchHitResponse = z.infer<typeof searchHitResponseSchema>;
