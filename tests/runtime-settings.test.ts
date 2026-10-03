import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/database", () => ({ database: { db: {} } }));
vi.mock("@/infrastructure/database/repositories/app-settings-repository", () => ({
  createAppSettingsRepository: () => ({ get })
}));

import {
  getEffectiveRuntimeEnvironment,
  invalidateRuntimeSettingsCache
} from "@/lib/runtime-settings";

describe("runtime settings cache", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, Symbol.for("agent-memory.runtime-settings.base-environment"));
    invalidateRuntimeSettingsCache();
    get.mockReset();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("shares one database read across concurrent cache misses", async () => {
    let finishRead!: (value: unknown) => void;
    get.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    const requests = Array.from({ length: 20 }, () => getEffectiveRuntimeEnvironment());
    finishRead({ overrides: { ADMIN_EMAILS: "admin@example.com" } });
    const results = await Promise.all(requests);
    expect(get).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result === results[0])).toBe(true);
  });

  it("propagates a failed read and allows the next request to refresh", async () => {
    const failure = new Error("database unavailable");
    get.mockRejectedValueOnce(failure);
    await expect(getEffectiveRuntimeEnvironment()).rejects.toBe(failure);
    get.mockResolvedValue({ overrides: { ADMIN_EMAILS: "admin@example.com" } });
    expect((await getEffectiveRuntimeEnvironment()).ADMIN_EMAILS).toBe("admin@example.com");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("shares the new read when an in-flight cache generation is invalidated", async () => {
    let finishOldRead!: (value: unknown) => void;
    let finishNewRead!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise((resolve) => { finishOldRead = resolve; }));
    get.mockReturnValueOnce(new Promise((resolve) => { finishNewRead = resolve; }));
    const oldRequest = getEffectiveRuntimeEnvironment();
    invalidateRuntimeSettingsCache();
    const newRequest = getEffectiveRuntimeEnvironment();
    finishOldRead({ overrides: { ADMIN_EMAILS: "old@example.com" } });
    finishNewRead({ overrides: { ADMIN_EMAILS: "new@example.com" } });
    const results = await Promise.all([oldRequest, newRequest]);
    expect(results.map((result) => result.ADMIN_EMAILS)).toEqual([
      "new@example.com", "new@example.com"
    ]);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("refreshes the embedding floor across requests without applying dimension changes live", async () => {
    vi.stubEnv("AUTH_PASSWORD", "true");
    vi.stubEnv("EMBEDDING_DIM", "native");
    vi.stubEnv("EMBEDDING_MIN_SCORE", "0.25");
    vi.resetModules();
    get.mockResolvedValue({ overrides: { EMBEDDING_MIN_SCORE: "0.2", EMBEDDING_DIM: "1024" } });
    const runtime = await import("@/lib/runtime-settings");
    expect(await runtime.getEffectiveEmbeddingMinimumScore()).toBe(0.2);
    get.mockResolvedValue({ overrides: { EMBEDDING_MIN_SCORE: "0.7", EMBEDDING_DIM: "1024" } });
    await runtime.applyLiveRuntimeSettingsOverrides();
    expect(await runtime.getEffectiveEmbeddingMinimumScore()).toBe(0.7);
    expect(process.env.EMBEDDING_DIM).toBe("native");
  });
  it("does not reinstall a stale read after an override is saved", async () => {
    invalidateRuntimeSettingsCache();
    let finishRead!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
    const pending = getEffectiveRuntimeEnvironment();
    invalidateRuntimeSettingsCache();
    get.mockResolvedValue({ overrides: { ADMIN_EMAILS: "new@example.com" } });
    finishRead({ overrides: { ADMIN_EMAILS: "old@example.com" } });
    expect((await pending).ADMIN_EMAILS).toBe("new@example.com");
    expect((await getEffectiveRuntimeEnvironment()).ADMIN_EMAILS).toBe("new@example.com");
  });

  it("loads persisted startup overrides in a fresh runtime and resets to the original env", async () => {
    vi.stubEnv("AUTH_PASSWORD", "true");
    vi.stubEnv("LOG_LEVEL", "info");
    vi.resetModules();
    get.mockResolvedValue({ overrides: { LOG_LEVEL: "debug" } });
    const runtime = await import("@/lib/runtime-settings");
    await runtime.applyRuntimeSettingsOverrides();
    expect(process.env.LOG_LEVEL).toBe("debug");
    vi.resetModules();
    const routeRuntime = await import("@/lib/runtime-settings");
    get.mockResolvedValue({ overrides: {} });
    await routeRuntime.applyRuntimeSettingsOverrides();
    expect(process.env.LOG_LEVEL).toBe("info");
  });

  it("rejects invalid persisted settings before applying any env changes", async () => {
    vi.stubEnv("AUTH_PASSWORD", "true");
    vi.stubEnv("LOG_LEVEL", "info");
    vi.resetModules();
    get.mockResolvedValue({ overrides: { LOG_LEVEL: "", AUTH_PASSWORD: "false" } });
    const runtime = await import("@/lib/runtime-settings");
    await expect(runtime.applyRuntimeSettingsOverrides()).rejects.toThrow();
    expect(process.env.LOG_LEVEL).toBe("info");
    expect(process.env.AUTH_PASSWORD).toBe("true");
  });
});
