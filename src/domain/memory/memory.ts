export const memoryKinds = [
  "rule",
  "experience",
  "decision",
  "preference",
  "fact"
] as const;

export type MemoryKind = (typeof memoryKinds)[number];

export const memorySourceTypes = ["agent", "user", "document", "system"] as const;

export type MemorySourceType = (typeof memorySourceTypes)[number];

export const memoryStatuses = ["active", "archived"] as const;
export type MemoryStatus = (typeof memoryStatuses)[number];

export const memoryPermissions = ["read", "write", "manage"] as const;
export type MemoryPermission = (typeof memoryPermissions)[number];

export type MemoryScope =
  | Readonly<{
      kind: "organization";
      organizationId: string;
    }>
  | Readonly<{
      kind: "team";
      organizationId: string;
      teamId: string;
    }>
  | Readonly<{
      kind: "user";
      organizationId: string;
      userId: string;
    }>;

export interface MemorySource {
  readonly type: MemorySourceType;
  readonly uri?: string;
  readonly agentId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryEmbedding {
  readonly model: string;
  readonly values: readonly number[];
}

export type MemoryAccessGrant =
  | Readonly<{
      principalKind: "team";
      teamId: string;
      permission: MemoryPermission;
    }>
  | Readonly<{
      principalKind: "user";
      userId: string;
      permission: MemoryPermission;
    }>;

export interface MemoryRevision {
  readonly title?: string;
  readonly content?: string;
  readonly source?: MemorySource;
  readonly embedding?: MemoryEmbedding | null;
  readonly accessGrants?: readonly MemoryAccessGrant[];
  readonly expiresAt?: Date | null;
  readonly now: Date;
}

export interface MemoryVersionSnapshot {
  readonly memoryId: string;
  readonly version: number;
  readonly title: string;
  readonly content: string;
  readonly source: Readonly<MemorySource>;
  readonly embedding?: Readonly<MemoryEmbedding>;
  readonly accessGrants: readonly MemoryAccessGrant[];
  readonly validFrom: Date;
  readonly expiresAt?: Date;
  readonly status: MemoryStatus;
  readonly changedBy: string;
  readonly changeReason?: string;
  readonly createdAt: Date;
}

export interface Memory {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly title: string;
  readonly content: string;
  readonly source: Readonly<MemorySource>;
  readonly embedding?: Readonly<MemoryEmbedding>;
  readonly accessGrants: readonly MemoryAccessGrant[];
  readonly createdBy: string;
  readonly validFrom: Date;
  readonly expiresAt?: Date;
  readonly status: MemoryStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface NewMemory {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly title: string;
  readonly content: string;
  readonly source: MemorySource;
  readonly embedding?: MemoryEmbedding;
  readonly accessGrants?: readonly MemoryAccessGrant[];
  readonly createdBy: string;
  readonly validFrom: Date;
  readonly expiresAt?: Date;
  readonly now: Date;
}

export class InvalidMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemoryError";
  }
}

function normalizeSource(source: MemorySource): Readonly<MemorySource> {
  return Object.freeze({
    ...source,
    ...(source.metadata
      ? { metadata: Object.freeze({ ...source.metadata }) }
      : {})
  });
}

function normalizeEmbedding(
  embedding: MemoryEmbedding
): Readonly<MemoryEmbedding> {
  const model = embedding.model.trim();
  if (model.length === 0) {
    throw new InvalidMemoryError("memory embedding model must not be empty");
  }
  if (
    embedding.values.length === 0 ||
    embedding.values.some((value) => !Number.isFinite(value))
  ) {
    throw new InvalidMemoryError("memory embedding must contain finite values");
  }

  return Object.freeze({ model, values: Object.freeze([...embedding.values]) });
}

function normalizeAccessGrants(
  grants: readonly MemoryAccessGrant[]
): readonly MemoryAccessGrant[] {
  const principals = new Set<string>();
  return Object.freeze(
    grants.map((grant) => {
      const principalId =
        grant.principalKind === "team" ? grant.teamId : grant.userId;
      if (principalId.trim().length === 0) {
        throw new InvalidMemoryError(
          "memory access grant principal must not be empty"
        );
      }
      const principal = `${grant.principalKind}:${principalId}`;
      if (principals.has(principal)) {
        throw new InvalidMemoryError(
          "memory access grants must contain unique principals"
        );
      }
      principals.add(principal);
      return Object.freeze({ ...grant });
    })
  );
}

export function createMemory(input: NewMemory): Memory {
  const title = input.title.trim();
  const content = input.content.trim();

  if (title.length === 0) {
    throw new InvalidMemoryError("memory title must not be empty");
  }

  if (content.length === 0) {
    throw new InvalidMemoryError("memory content must not be empty");
  }

  if (input.expiresAt && input.expiresAt <= input.validFrom) {
    throw new InvalidMemoryError("memory expiry must be after its valid-from time");
  }

  return Object.freeze({
    id: input.id,
    kind: input.kind,
    scope: Object.freeze({ ...input.scope }),
    title,
    content,
    source: normalizeSource(input.source),
    ...(input.embedding
      ? { embedding: normalizeEmbedding(input.embedding) }
      : {}),
    accessGrants: normalizeAccessGrants(input.accessGrants ?? []),
    createdBy: input.createdBy,
    validFrom: new Date(input.validFrom),
    ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
    status: "active",
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now),
    version: 1
  });
}

export function reviseMemory(
  memory: Memory,
  revision: MemoryRevision
): Memory {
  if (memory.status !== "active") {
    throw new InvalidMemoryError("archived memory cannot be revised");
  }

  const title = revision.title?.trim() ?? memory.title;
  const content = revision.content?.trim() ?? memory.content;
  if (title.length === 0) {
    throw new InvalidMemoryError("memory title must not be empty");
  }
  if (content.length === 0) {
    throw new InvalidMemoryError("memory content must not be empty");
  }

  const expiresAt =
    revision.expiresAt === undefined
      ? memory.expiresAt
      : revision.expiresAt ?? undefined;
  if (expiresAt && expiresAt <= memory.validFrom) {
    throw new InvalidMemoryError("memory expiry must be after its valid-from time");
  }

  const embedding =
    revision.embedding === undefined
      ? memory.embedding
      : revision.embedding
        ? normalizeEmbedding(revision.embedding)
        : undefined;
  const accessGrants =
    revision.accessGrants === undefined
      ? memory.accessGrants
      : normalizeAccessGrants(revision.accessGrants);

  return Object.freeze({
    ...memory,
    title,
    content,
    source: revision.source
      ? normalizeSource(revision.source)
      : memory.source,
    ...(embedding ? { embedding } : { embedding: undefined }),
    accessGrants,
    ...(expiresAt ? { expiresAt: new Date(expiresAt) } : { expiresAt: undefined }),
    updatedAt: new Date(revision.now),
    version: memory.version + 1
  });
}

export function archiveMemory(memory: Memory, now: Date): Memory {
  if (memory.status !== "active") {
    throw new InvalidMemoryError("memory is already archived");
  }

  return Object.freeze({
    ...memory,
    status: "archived",
    updatedAt: new Date(now),
    version: memory.version + 1
  });
}
