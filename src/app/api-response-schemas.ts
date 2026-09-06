import { z } from "zod";

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

export const organizationsResponseSchema = z.object({
  organizations: z.array(organizationSummaryResponseSchema)
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

export const joinOrganizationResponseSchema = z.object({
  status: z.enum(["active", "pending"])
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
  newMemberStatus: z.enum(["active", "pending"]).optional(),
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
  key: z.string().min(1),
  kind: z.string().min(1),
  canonicalName: z.string().min(1),
  summary: z.string().optional()
});

const proposedRelationshipResponseSchema = z.object({
  sourceKey: z.string().min(1),
  targetKey: z.string().min(1),
  predicate: z.string().min(1)
});

export const knowledgeCandidateResponseSchema = z.object({
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

export type SearchHitResponse = z.infer<typeof searchHitResponseSchema>;
