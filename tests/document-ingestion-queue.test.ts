import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createQueue: vi.fn(),
  start: vi.fn(),
  instances: [] as Array<{
    on: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  send: vi.fn()
}));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    readonly on = vi.fn();
    readonly start = mocks.start;
    readonly createQueue = mocks.createQueue;
    readonly send = mocks.send;
    readonly stop = vi.fn().mockResolvedValue(undefined);

    constructor() {
      mocks.instances.push(this);
    }
  }
}));

import { createPgBossDocumentIngestionQueue } from "@/infrastructure/queue/document-ingestion-queue";

describe("document ingestion queue", () => {
  beforeEach(() => {
    mocks.createQueue.mockReset().mockResolvedValue(undefined);
    mocks.start.mockReset().mockResolvedValue(undefined);
    mocks.instances.splice(0);
    mocks.send.mockReset();
  });

  it.each(["start", "createQueue"] as const)("cleans up partial %s failure before creating a fresh queue client", async (stage) => {
    const startupFailure = new Error(`${stage} failed`);
    mocks[stage].mockRejectedValueOnce(startupFailure);
    const queue = createPgBossDocumentIngestionQueue("postgresql://database", vi.fn());

    await expect(queue.start()).rejects.toBe(startupFailure);
    expect(mocks.instances[0]?.stop).toHaveBeenCalledWith({
      close: true,
      graceful: true,
      timeout: 30_000
    });

    await expect(queue.start()).resolves.toBe(mocks.instances[1]);
    expect(mocks.instances).toHaveLength(2);
  });

  it("distinguishes a new job from an existing exclusive job", async () => {
    mocks.send.mockResolvedValueOnce("job-1").mockResolvedValueOnce(null);
    const queue = createPgBossDocumentIngestionQueue("postgresql://database", vi.fn());

    await expect(queue.enqueue("organization-1", "document-1", "generation-1", "requester")).resolves.toBe(
      "queued"
    );
    await expect(queue.enqueue("organization-1", "document-1", "generation-1", "requester")).resolves.toBe(
      "already_queued"
    );
    expect(mocks.createQueue).toHaveBeenCalledWith(
      "document-ingestion-v3",
      expect.objectContaining({ policy: "exclusive" })
    );
    expect(mocks.createQueue).toHaveBeenCalledWith(
      "document-knowledge-enrichment-v3",
      expect.objectContaining({ policy: "exclusive" })
    );
  });
});
