export interface IngestionIdentity {
  readonly organizationId: string;
  readonly userId: string;
  readonly operation: "memory.create" | "document.upload" | "document.retry";
  readonly key: string;
}

export interface IngestionReceipt extends IngestionIdentity {
  readonly payloadHash: string;
  readonly resourceId: string;
  readonly createdAt: Date;
}

export interface IngestionReceiptRepository {
  find(identity: IngestionIdentity): Promise<IngestionReceipt | null>;
}

export function assertIngestionResource(receipt: IngestionReceipt, operation: IngestionIdentity["operation"],
  organizationId: string, userId: string, resourceId: string): void {
  if (receipt.operation !== operation || receipt.organizationId !== organizationId ||
    receipt.userId !== userId || receipt.resourceId !== resourceId) {
    throw new Error("ingestion receipt does not match its resource");
  }
}

export class IngestionConflictError extends Error {
  constructor() { super("idempotency key has a different payload"); this.name = "IngestionConflictError"; }
}

/** A concurrent request committed the resource first. Read its current authorized state. */
export class IngestionReplayError extends Error {
  constructor(readonly receipt: IngestionReceipt) { super("ingestion already completed"); this.name = "IngestionReplayError"; }
}
