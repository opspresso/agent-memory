import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL
} from "drizzle-orm";

import type {
  OrganizationAccess,
  ScopedResource
} from "@/domain/identity/organization-access";
import type {
  KnowledgeEdge,
  KnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import type {
  KnowledgeGraphRepository,
  KnowledgeNodeSearchInput
} from "@/domain/knowledge/knowledge-graph-repository";

import type { AgentMemoryDatabase } from "../client";
import { knowledgeEdges, knowledgeNodes } from "../schema";

type NodeRow = typeof knowledgeNodes.$inferSelect;
type EdgeRow = typeof knowledgeEdges.$inferSelect;

function scopeFromRow(row: {
  organizationId: string;
  scopeKind: "organization" | "team" | "user";
  teamId: string | null;
  userId: string | null;
}): ScopedResource {
  if (row.scopeKind === "team" && row.teamId) {
    return {
      kind: "team",
      organizationId: row.organizationId,
      teamId: row.teamId
    };
  }
  if (row.scopeKind === "user" && row.userId) {
    return {
      kind: "user",
      organizationId: row.organizationId,
      userId: row.userId
    };
  }
  return { kind: "organization", organizationId: row.organizationId };
}

function nodeFromRow(row: NodeRow): KnowledgeNode {
  return {
    id: row.id,
    scope: scopeFromRow(row),
    kind: row.kind,
    canonicalName: row.canonicalName,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.embedding && row.embeddingModel
      ? { embedding: { model: row.embeddingModel, values: row.embedding } }
      : {}),
    properties: row.properties,
    source: {
      ...(row.sourceMemoryId ? { memoryId: row.sourceMemoryId } : {}),
      ...(row.sourceChunkId ? { chunkId: row.sourceChunkId } : {})
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function edgeFromRow(row: EdgeRow): KnowledgeEdge {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scope: scopeFromRow(row),
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    predicate: row.predicate,
    properties: row.properties,
    source: {
      ...(row.sourceMemoryId ? { memoryId: row.sourceMemoryId } : {}),
      ...(row.sourceChunkId ? { chunkId: row.sourceChunkId } : {})
    },
    createdAt: row.createdAt
  };
}

function nodeAccessPredicate(access: OrganizationAccess): SQL {
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(knowledgeNodes.scopeKind, "organization"),
    and(
      eq(knowledgeNodes.scopeKind, "user"),
      eq(knowledgeNodes.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(knowledgeNodes.scopeKind, "team"),
          inArray(knowledgeNodes.teamId, teamIds)
        )
      : undefined
  )!;
}

function edgeAccessPredicate(access: OrganizationAccess): SQL {
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(knowledgeEdges.scopeKind, "organization"),
    and(
      eq(knowledgeEdges.scopeKind, "user"),
      eq(knowledgeEdges.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(knowledgeEdges.scopeKind, "team"),
          inArray(knowledgeEdges.teamId, teamIds)
        )
      : undefined
  )!;
}

function nodeValues(node: KnowledgeNode) {
  return {
    id: node.id,
    organizationId: node.scope.organizationId,
    scopeKind: node.scope.kind,
    teamId: node.scope.kind === "team" ? node.scope.teamId : null,
    userId: node.scope.kind === "user" ? node.scope.userId : null,
    kind: node.kind,
    canonicalName: node.canonicalName,
    summary: node.summary ?? null,
    embedding: node.embedding?.values ?? null,
    embeddingModel: node.embedding?.model ?? null,
    properties: node.properties,
    sourceMemoryId: node.source.memoryId ?? null,
    sourceChunkId: node.source.chunkId ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  };
}

function edgeValues(edge: KnowledgeEdge) {
  return {
    id: edge.id,
    organizationId: edge.organizationId,
    scopeKind: edge.scope.kind,
    teamId: edge.scope.kind === "team" ? edge.scope.teamId : null,
    userId: edge.scope.kind === "user" ? edge.scope.userId : null,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    predicate: edge.predicate,
    properties: edge.properties,
    sourceMemoryId: edge.source.memoryId ?? null,
    sourceChunkId: edge.source.chunkId ?? null,
    createdAt: edge.createdAt
  };
}

function scoreExpressions(input: KnowledgeNodeSearchInput) {
  const rawLexicalScore = sql<number>`ts_rank_cd(
    ${knowledgeNodes.search},
    websearch_to_tsquery('simple', ${input.query})
  )`;
  const lexicalScore = sql<number>`${rawLexicalScore} / (1 + ${rawLexicalScore})`;
  if (!input.queryEmbedding) {
    return {
      lexicalScore,
      vectorScore: sql<number>`0::double precision`,
      score: lexicalScore,
      matches: sql`${knowledgeNodes.search} @@ websearch_to_tsquery('simple', ${input.query})`
    };
  }

  const vectorLiteral = `[${input.queryEmbedding.values.join(",")}]`;
  const vectorScore = sql<number>`CASE
    WHEN ${knowledgeNodes.embedding} IS NOT NULL
      AND ${knowledgeNodes.embeddingModel} = ${input.queryEmbedding.model}
    THEN GREATEST(0, LEAST(1, 1 - ((${knowledgeNodes.embedding} <=> ${vectorLiteral}::vector) / 2)))
    ELSE 0
  END`;
  return {
    lexicalScore,
    vectorScore,
    score: sql<number>`(0.4 * ${lexicalScore}) + (0.6 * ${vectorScore})`,
    matches: or(
      sql`${knowledgeNodes.search} @@ websearch_to_tsquery('simple', ${input.query})`,
      and(
        isNotNull(knowledgeNodes.embedding),
        eq(knowledgeNodes.embeddingModel, input.queryEmbedding.model)
      )
    )
  };
}

export function createKnowledgeGraphRepository(
  db: AgentMemoryDatabase
): KnowledgeGraphRepository {
  return {
    async saveNode(node) {
      const values = nodeValues(node);
      const [row] = await db
        .insert(knowledgeNodes)
        .values(values)
        .onConflictDoUpdate({
          target: [
            knowledgeNodes.organizationId,
            knowledgeNodes.scopeKind,
            knowledgeNodes.teamId,
            knowledgeNodes.userId,
            knowledgeNodes.kind,
            knowledgeNodes.canonicalName
          ],
          set: {
            summary: sql`coalesce(excluded.summary, ${knowledgeNodes.summary})`,
            embedding: sql`coalesce(excluded.embedding, ${knowledgeNodes.embedding})`,
            embeddingModel: sql`coalesce(excluded.embedding_model, ${knowledgeNodes.embeddingModel})`,
            properties: sql`${knowledgeNodes.properties} || excluded.properties`,
            sourceMemoryId: sql`coalesce(excluded.source_memory_id, ${knowledgeNodes.sourceMemoryId})`,
            sourceChunkId: sql`coalesce(excluded.source_chunk_id, ${knowledgeNodes.sourceChunkId})`,
            updatedAt: values.updatedAt
          }
        })
        .returning();
      if (!row) {
        throw new Error("knowledge node upsert returned no row");
      }
      return nodeFromRow(row);
    },

    async findNodeById(organizationId, nodeId) {
      const [row] = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, organizationId),
            eq(knowledgeNodes.id, nodeId)
          )
        )
        .limit(1);
      return row ? nodeFromRow(row) : null;
    },

    async saveEdge(edge) {
      const values = edgeValues(edge);
      const [row] = await db
        .insert(knowledgeEdges)
        .values(values)
        .onConflictDoUpdate({
          target: [
            knowledgeEdges.organizationId,
            knowledgeEdges.scopeKind,
            knowledgeEdges.teamId,
            knowledgeEdges.userId,
            knowledgeEdges.sourceNodeId,
            knowledgeEdges.predicate,
            knowledgeEdges.targetNodeId
          ],
          set: {
            properties: sql`${knowledgeEdges.properties} || excluded.properties`,
            sourceMemoryId: sql`coalesce(excluded.source_memory_id, ${knowledgeEdges.sourceMemoryId})`,
            sourceChunkId: sql`coalesce(excluded.source_chunk_id, ${knowledgeEdges.sourceChunkId})`
          }
        })
        .returning();
      if (!row) {
        throw new Error("knowledge edge upsert returned no row");
      }
      return edgeFromRow(row);
    },

    async searchNodes(input) {
      const scores = scoreExpressions(input);
      const rows = await db
        .select({
          node: knowledgeNodes,
          lexicalScore: scores.lexicalScore,
          vectorScore: scores.vectorScore,
          score: scores.score
        })
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, input.access.organizationId),
            nodeAccessPredicate(input.access),
            scores.matches
          )
        )
        .orderBy(desc(scores.score), knowledgeNodes.canonicalName)
        .limit(input.limit);
      return rows.map((row) => ({
        node: nodeFromRow(row.node),
        lexicalScore: row.lexicalScore,
        vectorScore: row.vectorScore,
        score: row.score
      }));
    },

    async findNeighborhood(access, nodeId, depth, limit) {
      const rootRows = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, access.organizationId),
            eq(knowledgeNodes.id, nodeId),
            nodeAccessPredicate(access)
          )
        )
        .limit(1);
      const root = rootRows[0];
      if (!root) {
        return { nodes: [], edges: [] };
      }

      const nodesById = new Map([[root.id, root]]);
      const edgesById = new Map<string, EdgeRow>();
      let frontier = [root.id];
      for (let level = 0; level < depth && frontier.length > 0; level += 1) {
        const edgeRows = await db
          .select()
          .from(knowledgeEdges)
          .where(
            and(
              eq(knowledgeEdges.organizationId, access.organizationId),
              edgeAccessPredicate(access),
              or(
                inArray(knowledgeEdges.sourceNodeId, frontier),
                inArray(knowledgeEdges.targetNodeId, frontier)
              )
            )
          )
          .limit(limit * 4);
        const candidateIds = new Set<string>();
        for (const edge of edgeRows) {
          edgesById.set(edge.id, edge);
          if (!nodesById.has(edge.sourceNodeId)) {
            candidateIds.add(edge.sourceNodeId);
          }
          if (!nodesById.has(edge.targetNodeId)) {
            candidateIds.add(edge.targetNodeId);
          }
        }
        const remaining = limit - nodesById.size;
        if (candidateIds.size === 0 || remaining <= 0) {
          break;
        }
        const nextRows = await db
          .select()
          .from(knowledgeNodes)
          .where(
            and(
              eq(knowledgeNodes.organizationId, access.organizationId),
              inArray(knowledgeNodes.id, [...candidateIds]),
              nodeAccessPredicate(access)
            )
          )
          .limit(remaining);
        frontier = nextRows.map((row) => row.id);
        for (const row of nextRows) {
          nodesById.set(row.id, row);
        }
      }

      return {
        nodes: [...nodesById.values()].map(nodeFromRow),
        edges: [...edgesById.values()]
          .filter(
            (edge) =>
              nodesById.has(edge.sourceNodeId) &&
              nodesById.has(edge.targetNodeId)
          )
          .map(edgeFromRow)
      };
    }
  };
}
