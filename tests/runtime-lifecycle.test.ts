import { describe, expect, it, vi } from "vitest";

import {
  registerRuntimeShutdown,
  runRuntimeShutdownSteps,
  type RuntimeSignal
} from "@/lib/runtime-lifecycle";

describe("runtime lifecycle", () => {
  it("runs shutdown steps in dependency order", async () => {
    const calls: string[] = [];

    await runRuntimeShutdownSteps([
      {
        name: "queue",
        execute: async () => {
          calls.push("queue");
        }
      },
      {
        name: "database",
        execute: async () => {
          calls.push("database");
        }
      },
      {
        name: "telemetry",
        execute: async () => {
          calls.push("telemetry");
        }
      }
    ]);

    expect(calls).toEqual(["queue", "database", "telemetry"]);
  });

  it("attempts every shutdown step and aggregates failures", async () => {
    const database = vi.fn().mockRejectedValue(new Error("database failure"));
    const telemetry = vi.fn();

    const result = runRuntimeShutdownSteps([
      { name: "database", execute: database },
      { name: "telemetry", execute: telemetry }
    ]);

    await expect(result).rejects.toMatchObject({
      message: "runtime shutdown failed",
      errors: [expect.objectContaining({ message: "database shutdown failed" })]
    });
    expect(telemetry).toHaveBeenCalledOnce();
  });

  it("handles repeated signals with one successful shutdown", async () => {
    const listeners = new Map<RuntimeSignal, () => void>();
    const exit = vi.fn();
    const shutdown = vi.fn();
    const logger = { error: vi.fn(), info: vi.fn() };
    registerRuntimeShutdown(shutdown, logger, {
      exit,
      once: (signal, listener) => {
        listeners.set(signal, listener);
      }
    });

    listeners.get("SIGTERM")?.();
    listeners.get("SIGINT")?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(shutdown).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { signal: "SIGTERM" },
      "runtime shutdown completed"
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("exits unsuccessfully when shutdown fails", async () => {
    const listeners = new Map<RuntimeSignal, () => void>();
    const exit = vi.fn();
    const failure = new Error("shutdown failure");
    const logger = { error: vi.fn(), info: vi.fn() };
    registerRuntimeShutdown(
      vi.fn().mockRejectedValue(failure),
      logger,
      {
        exit,
        once: (signal, listener) => {
          listeners.set(signal, listener);
        }
      }
    );

    listeners.get("SIGINT")?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, signal: "SIGINT" },
      "runtime shutdown failed"
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
