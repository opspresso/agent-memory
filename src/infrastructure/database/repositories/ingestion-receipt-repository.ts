import { and, eq, sql } from "drizzle-orm";
import { IngestionConflictError, IngestionReplayError, type IngestionIdentity,
  type IngestionReceipt, type IngestionReceiptRepository } from "@/domain/shared/ingestion-receipt";
import type { AgentMemoryDatabase } from "../client";
import { ingestionReceipts } from "../schema/ingestion-receipts";

type Executor = Pick<AgentMemoryDatabase, "select" | "insert" | "execute">;

async function lockReceipt(db: Executor, identity: IngestionIdentity): Promise<void> {
  const key = JSON.stringify([identity.organizationId, identity.userId, identity.operation, identity.key]);
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function findIngestionReceipt(db: Executor, identity: IngestionIdentity): Promise<IngestionReceipt | null> {
  await lockReceipt(db, identity);
  const [row] = await db.select().from(ingestionReceipts).where(and(
    eq(ingestionReceipts.organizationId, identity.organizationId), eq(ingestionReceipts.userId, identity.userId),
    eq(ingestionReceipts.operation, identity.operation), eq(ingestionReceipts.key, identity.key)
  )).limit(1);
  return row ? { ...row, operation: row.operation as IngestionIdentity["operation"] } : null;
}

export async function refuseIngestionReplay(db: Executor, receipt: IngestionReceipt): Promise<void> {
  const previous = await findIngestionReceipt(db, receipt);
  if (!previous) return;
  if (previous.payloadHash !== receipt.payloadHash) throw new IngestionConflictError();
  throw new IngestionReplayError(previous);
}

/** Call inside the same transaction that inserts the resource. */
export async function insertIngestionReceipt(db: Executor, receipt: IngestionReceipt): Promise<void> {
  await lockReceipt(db, receipt);
  const inserted = await db.insert(ingestionReceipts).values(receipt).onConflictDoNothing().returning();
  if (!inserted.length) await refuseIngestionReplay(db, receipt);
}

export function createIngestionReceiptRepository(db: AgentMemoryDatabase): IngestionReceiptRepository {
  return { find: (identity) => db.transaction((transaction) => findIngestionReceipt(transaction, identity)) };
}
