import {
  createMemory,
  type Memory,
  type MemoryKind,
  type MemoryScope,
  type MemorySource
} from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

export interface CreateMemoryInput {
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly title: string;
  readonly content: string;
  readonly source: MemorySource;
  readonly createdBy: string;
  readonly validFrom?: Date;
  readonly expiresAt?: Date;
}

export interface CreateMemoryDependencies {
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly repository: MemoryRepository;
}

export function buildCreateMemory(dependencies: CreateMemoryDependencies) {
  return async function execute(input: CreateMemoryInput): Promise<Memory> {
    const now = dependencies.clock();
    const memory = createMemory({
      ...input,
      id: dependencies.generateId(),
      validFrom: input.validFrom ?? now,
      now
    });

    await dependencies.repository.save(memory);

    return memory;
  };
}
