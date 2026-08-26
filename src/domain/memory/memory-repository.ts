import type { Memory } from "./memory";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

export interface MemorySearchInput {
  readonly access: OrganizationAccess;
  readonly query: string;
  readonly queryEmbedding?: Readonly<{
    model: string;
    values: readonly number[];
  }>;
  readonly now: Date;
  readonly limit: number;
}

export interface MemorySearchHit {
  readonly memory: Memory;
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly score: number;
}

export type SaveMemoryRevisionResult = "saved" | "conflict" | "not_found";

export interface MemoryRepository {
  save(memory: Memory): Promise<void>;
  findById(organizationId: string, memoryId: string): Promise<Memory | null>;
  saveRevision(
    memory: Memory,
    expectedVersion: number,
    changedBy: string,
    changeReason?: string
  ): Promise<SaveMemoryRevisionResult>;
  search(input: MemorySearchInput): Promise<readonly MemorySearchHit[]>;
}
