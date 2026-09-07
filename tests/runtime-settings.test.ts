import { describe, expect, it, vi } from "vitest";

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
});
