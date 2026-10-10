import { and, eq } from "drizzle-orm";
import type { KnowledgeExtractionCheckpointKey, KnowledgeExtractionCheckpointRepository } from "@/domain/knowledge/knowledge-extraction-checkpoint";
import type { AgentMemoryDatabase } from "../client";
import { knowledgeExtractionCheckpoints } from "../schema";

export function createKnowledgeExtractionCheckpointRepository(db: AgentMemoryDatabase): KnowledgeExtractionCheckpointRepository {
  const find = async (key: KnowledgeExtractionCheckpointKey) => {
    const [row] = await db.select().from(knowledgeExtractionCheckpoints).where(and(
      eq(knowledgeExtractionCheckpoints.organizationId, key.organizationId),
      eq(knowledgeExtractionCheckpoints.chunkId, key.chunkId),
      eq(knowledgeExtractionCheckpoints.fingerprint, key.fingerprint)
    )).limit(1);
    return row ?? null;
  };
  return {
    find,
    async save(checkpoint) {
      const [row] = await db.insert(knowledgeExtractionCheckpoints).values(checkpoint).onConflictDoNothing().returning();
      if (row) return row;
      const existing = await find(checkpoint);
      if (!existing) throw new Error("knowledge extraction checkpoint disappeared");
      return existing;
    }
  };
}
