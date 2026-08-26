import type { Memory } from "./memory";

export interface MemoryRepository {
  save(memory: Memory): Promise<void>;
}
