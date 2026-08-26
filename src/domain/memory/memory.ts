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
}

export interface Memory {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly title: string;
  readonly content: string;
  readonly source: Readonly<MemorySource>;
  readonly createdBy: string;
  readonly validFrom: Date;
  readonly expiresAt?: Date;
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
    source: Object.freeze({ ...input.source }),
    createdBy: input.createdBy,
    validFrom: new Date(input.validFrom),
    ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now),
    version: 1
  });
}
