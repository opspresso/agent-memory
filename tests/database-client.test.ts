import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ end: vi.fn<() => Promise<void>>() }));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return { Pool: class extends EventEmitter {
    end() { return mocks.end(); }
  } };
});
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn(() => ({})) }));

import { createDatabase } from "@/infrastructure/database/client";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("database connection lifecycle", () => {
  beforeEach(() => { mocks.end.mockReset().mockResolvedValue(undefined); });

  it("waits for the physical client end after pool.end resolves", async () => {
    const poolEnd = deferred();
    mocks.end.mockReturnValue(poolEnd.promise);
    const database = createDatabase("postgresql://database");
    const client = new EventEmitter();
    database.pool.emit("connect", client);
    const finished = vi.fn();
    const closing = database.close().then(finished);

    poolEnd.resolve();
    await poolEnd.promise;
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();

    client.emit("end");
    await closing;
    expect(finished).toHaveBeenCalledOnce();
  });

  it("waits for every connected client and reuses one close promise", async () => {
    const database = createDatabase("postgresql://database");
    const first = new EventEmitter(), second = new EventEmitter();
    database.pool.emit("connect", first);
    database.pool.emit("connect", second);
    const closing = database.close();
    expect(database.close()).toBe(closing);
    const finished = vi.fn();
    void closing.then(finished);
    await Promise.resolve();

    second.emit("end");
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    first.emit("end");
    await closing;
    expect(finished).toHaveBeenCalledOnce();
    expect(database.close()).toBe(closing);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("includes connections established while pool shutdown is draining", async () => {
    const poolEnd = deferred();
    mocks.end.mockReturnValue(poolEnd.promise);
    const database = createDatabase("postgresql://database");
    const finished = vi.fn();
    const closing = database.close().then(finished);
    const client = new EventEmitter();
    database.pool.emit("connect", client);
    poolEnd.resolve();
    await poolEnd.promise;
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    client.emit("end");
    await closing;
    expect(finished).toHaveBeenCalledOnce();
  });

  it("does not wait again for connections that already ended before close", async () => {
    const database = createDatabase("postgresql://database");
    const client = new EventEmitter();
    database.pool.emit("connect", client);
    client.emit("end");
    await database.close();
    expect(client.listenerCount("end")).toBe(0);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("preserves pool shutdown errors for every close caller", async () => {
    const failure = new Error("pool shutdown failed");
    mocks.end.mockRejectedValue(failure);
    const database = createDatabase("postgresql://database");
    const closing = database.close();
    await expect(closing).rejects.toBe(failure);
    expect(database.close()).toBe(closing);
    await expect(database.close()).rejects.toBe(failure);
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
