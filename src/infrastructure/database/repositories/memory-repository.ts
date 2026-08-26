import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL
} from "drizzle-orm";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type {
  Memory,
  MemoryAccessGrant,
  MemoryScope
} from "@/domain/memory/memory";
import type {
  MemoryRepository,
  MemorySearchHit,
  MemorySearchInput,
  SaveMemoryRevisionResult
} from "@/domain/memory/memory-repository";

import type { AgentMemoryDatabase } from "../client";
import {
  memories,
  memoryAccessGrants,
  memoryVersions
} from "../schema";

type MemoryRow = typeof memories.$inferSelect;
type GrantRow = typeof memoryAccessGrants.$inferSelect;

function scopeFromRow(row: MemoryRow): MemoryScope {
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

function grantFromRow(row: GrantRow): MemoryAccessGrant | null {
  if (row.principalKind === "team" && row.teamId) {
    return {
      principalKind: "team",
      teamId: row.teamId,
      permission: row.permission
    };
  }
  if (row.principalKind === "user" && row.userId) {
    return {
      principalKind: "user",
      userId: row.userId,
      permission: row.permission
    };
  }
  return null;
}

function memoryFromRow(row: MemoryRow, grantRows: readonly GrantRow[]): Memory {
  return {
    id: row.id,
    kind: row.kind,
    scope: scopeFromRow(row),
    title: row.title,
    content: row.content,
    source: {
      type: row.sourceType,
      ...(row.sourceUri ? { uri: row.sourceUri } : {}),
      ...(row.sourceAgentId ? { agentId: row.sourceAgentId } : {}),
      ...(Object.keys(row.sourceMetadata).length > 0
        ? { metadata: row.sourceMetadata }
        : {})
    },
    ...(row.embedding && row.embeddingModel
      ? { embedding: { model: row.embeddingModel, values: row.embedding } }
      : {}),
    accessGrants: grantRows.flatMap((grant) => {
      const mapped = grantFromRow(grant);
      return mapped ? [mapped] : [];
    }),
    createdBy: row.createdBy,
    validFrom: row.validFrom,
    ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.currentVersion
  };
}

function memoryValues(memory: Memory) {
  return {
    id: memory.id,
    organizationId: memory.scope.organizationId,
    scopeKind: memory.scope.kind,
    teamId: memory.scope.kind === "team" ? memory.scope.teamId : null,
    userId: memory.scope.kind === "user" ? memory.scope.userId : null,
    kind: memory.kind,
    title: memory.title,
    content: memory.content,
    sourceType: memory.source.type,
    sourceUri: memory.source.uri ?? null,
    sourceAgentId: memory.source.agentId ?? null,
    sourceMetadata: memory.source.metadata ?? {},
    embedding: memory.embedding?.values ?? null,
    embeddingModel: memory.embedding?.model ?? null,
    createdBy: memory.createdBy,
    validFrom: memory.validFrom,
    expiresAt: memory.expiresAt ?? null,
    status: memory.status,
    currentVersion: memory.version,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt
  };
}

function versionValues(
  memory: Memory,
  changedBy: string,
  changeReason?: string
) {
  return {
    organizationId: memory.scope.organizationId,
    memoryId: memory.id,
    version: memory.version,
    title: memory.title,
    content: memory.content,
    sourceType: memory.source.type,
    sourceUri: memory.source.uri ?? null,
    sourceAgentId: memory.source.agentId ?? null,
    sourceMetadata: memory.source.metadata ?? {},
    embedding: memory.embedding?.values ?? null,
    embeddingModel: memory.embedding?.model ?? null,
    validFrom: memory.validFrom,
    expiresAt: memory.expiresAt ?? null,
    status: memory.status,
    changedBy,
    changeReason: changeReason ?? null,
    createdAt: memory.updatedAt
  };
}

function principalPredicate(
  access: OrganizationAccess
): SQL | undefined {
  const teamIds = access.teams.map((team) => team.teamId);
  const grantPrincipal = or(
    and(
      eq(memoryAccessGrants.principalKind, "user"),
      eq(memoryAccessGrants.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(memoryAccessGrants.principalKind, "team"),
          inArray(memoryAccessGrants.teamId, teamIds)
        )
      : undefined
  );

  return or(
    eq(memories.scopeKind, "organization"),
    and(
      eq(memories.scopeKind, "user"),
      eq(memories.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(memories.scopeKind, "team"),
          inArray(memories.teamId, teamIds)
        )
      : undefined,
    sql`EXISTS (
      SELECT 1 FROM ${memoryAccessGrants}
          WHERE ${memoryAccessGrants.organizationId} = ${memories.organizationId}
            AND ${memoryAccessGrants.memoryId} = ${memories.id}
            AND ${grantPrincipal}
    )`
  );
}

async function grantRowsByMemoryIds(
  db: AgentMemoryDatabase,
  organizationId: string,
  memoryIds: readonly string[]
): Promise<Map<string, GrantRow[]>> {
  if (memoryIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(memoryAccessGrants)
    .where(
      and(
        eq(memoryAccessGrants.organizationId, organizationId),
        inArray(memoryAccessGrants.memoryId, [...memoryIds])
      )
    );

  return rows.reduce((byMemory, row) => {
    const grants = byMemory.get(row.memoryId) ?? [];
    grants.push(row);
    byMemory.set(row.memoryId, grants);
    return byMemory;
  }, new Map<string, GrantRow[]>());
}

function scoreExpressions(input: MemorySearchInput) {
  const rawLexicalScore = sql<number>`ts_rank_cd(
    ${memories.search},
    websearch_to_tsquery('simple', ${input.query})
  )`;
  const lexicalScore = sql<number>`${rawLexicalScore} / (1 + ${rawLexicalScore})`;
  if (!input.queryEmbedding) {
    return {
      lexicalScore,
      vectorScore: sql<number>`0::double precision`,
      score: lexicalScore,
      matches: sql`${memories.search} @@ websearch_to_tsquery('simple', ${input.query})`
    };
  }

  const vectorLiteral = `[${input.queryEmbedding.values.join(",")}]`;
  const vectorScore = sql<number>`CASE
    WHEN ${memories.embedding} IS NOT NULL
      AND ${memories.embeddingModel} = ${input.queryEmbedding.model}
    THEN GREATEST(0, LEAST(1, 1 - ((${memories.embedding} <=> ${vectorLiteral}::vector) / 2)))
    ELSE 0
  END`;
  return {
    lexicalScore,
    vectorScore,
    score: sql<number>`(0.4 * ${lexicalScore}) + (0.6 * ${vectorScore})`,
    matches: or(
      sql`${memories.search} @@ websearch_to_tsquery('simple', ${input.query})`,
      and(
        isNotNull(memories.embedding),
        eq(memories.embeddingModel, input.queryEmbedding.model)
      )
    )
  };
}

export function createMemoryRepository(
  db: AgentMemoryDatabase
): MemoryRepository {
  return {
    async save(memory) {
      await db.transaction(async (transaction) => {
        await transaction.insert(memories).values(memoryValues(memory));
        await transaction
          .insert(memoryVersions)
          .values(versionValues(memory, memory.createdBy));
        if (memory.accessGrants.length > 0) {
          await transaction.insert(memoryAccessGrants).values(
            memory.accessGrants.map((grant) => ({
              organizationId: memory.scope.organizationId,
              memoryId: memory.id,
              principalKind: grant.principalKind,
              teamId: grant.principalKind === "team" ? grant.teamId : null,
              userId: grant.principalKind === "user" ? grant.userId : null,
              permission: grant.permission,
              grantedBy: memory.createdBy
            }))
          );
        }
      });
    },

    async findById(organizationId, memoryId) {
      const [row] = await db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.organizationId, organizationId),
            eq(memories.id, memoryId)
          )
        )
        .limit(1);
      if (!row) {
        return null;
      }

      const grants = await grantRowsByMemoryIds(db, organizationId, [memoryId]);
      return memoryFromRow(row, grants.get(memoryId) ?? []);
    },

    async saveRevision(
      memory,
      expectedVersion,
      changedBy,
      changeReason
    ): Promise<SaveMemoryRevisionResult> {
      return db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(memories)
          .set({
            title: memory.title,
            content: memory.content,
            sourceType: memory.source.type,
            sourceUri: memory.source.uri ?? null,
            sourceAgentId: memory.source.agentId ?? null,
            sourceMetadata: memory.source.metadata ?? {},
            embedding: memory.embedding?.values ?? null,
            embeddingModel: memory.embedding?.model ?? null,
            expiresAt: memory.expiresAt ?? null,
            status: memory.status,
            currentVersion: memory.version,
            updatedAt: memory.updatedAt
          })
          .where(
            and(
              eq(memories.organizationId, memory.scope.organizationId),
              eq(memories.id, memory.id),
              eq(memories.currentVersion, expectedVersion)
            )
          )
          .returning({ id: memories.id });
        if (!updated) {
          const [existing] = await transaction
            .select({ id: memories.id })
            .from(memories)
            .where(
              and(
                eq(memories.organizationId, memory.scope.organizationId),
                eq(memories.id, memory.id)
              )
            )
            .limit(1);
          return existing ? "conflict" : "not_found";
        }

        await transaction
          .insert(memoryVersions)
          .values(versionValues(memory, changedBy, changeReason));
        return "saved";
      });
    },

    async search(input) {
      const score = scoreExpressions(input);
      const accessPredicate =
        input.access.role === "admin" || input.access.role === "owner"
          ? sql`true`
          : principalPredicate(input.access);
      const rows = await db
        .select({
          ...getTableColumns(memories),
          lexicalScore: score.lexicalScore,
          vectorScore: score.vectorScore,
          score: score.score
        })
        .from(memories)
        .where(
          and(
            eq(memories.organizationId, input.access.organizationId),
            eq(memories.status, "active"),
            lte(memories.validFrom, input.now),
            or(isNull(memories.expiresAt), sql`${memories.expiresAt} > ${input.now}`),
            accessPredicate,
            score.matches
          )
        )
        .orderBy(desc(score.score), desc(memories.updatedAt))
        .limit(input.limit);
      const grants = await grantRowsByMemoryIds(
        db,
        input.access.organizationId,
        rows.map((row) => row.id)
      );

      return rows.map(
        (row): MemorySearchHit => ({
          memory: memoryFromRow(row, grants.get(row.id) ?? []),
          lexicalScore: row.lexicalScore,
          vectorScore: row.vectorScore,
          score: row.score
        })
      );
    }
  };
}
