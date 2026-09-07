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
  beforeEach(() => { Reflect.deleteProperty(globalThis, Symbol.for("agent-memory.runtime-settings.base-environment")); });
  afterEach(() => { vi.unstubAllEnvs(); });
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
