import { describe, expect, it } from "vitest";
import { appSettingDefinitions } from "@/domain/settings/app-settings";
import { editSettingDraft, resolveSettingsSection, settingGroups } from "@/app/settings/settings-catalog";

describe("settings workspace", () => {
  it("exposes every supported setting exactly once, including enrichment concurrency", () => {
    const names = settingGroups.flatMap((group) => [...group.names]);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(appSettingDefinitions.map((field) => field.name).sort());
  });
  it("removes changes when the user returns to the saved value", () => {
    const draft = editSettingDraft({}, "LOG_LEVEL", "debug", "info", false);
    expect(draft).toEqual({ LOG_LEVEL: "debug" });
    expect(editSettingDraft(draft, "LOG_LEVEL", "info", "info", false)).toEqual({});
    expect(draft).toEqual({ LOG_LEVEL: "debug" });
  });
  it("keeps secret placeholders out of edits and lets replacement typing be cancelled", () => {
    expect(editSettingDraft({}, "EMBEDDING_API_KEY", "", "masked", true)).toEqual({});
    const draft = editSettingDraft({}, "EMBEDDING_API_KEY", "replacement", "masked", true);
    expect(draft).toEqual({ EMBEDDING_API_KEY: "replacement" });
    expect(editSettingDraft(draft, "EMBEDDING_API_KEY", "", "masked", true)).toEqual({});
  });
  it("resolves bookmarked sections only within the viewer's available settings", () => {
    expect(resolveSettingsSection("ai", false, true)).toBe("general");
    expect(resolveSettingsSection("ontology", true, false)).toBe("ai");
    expect(resolveSettingsSection("ontology", false, true)).toBe("ontology");
    expect(resolveSettingsSection("unknown", true, true)).toBe("ai");
    expect(resolveSettingsSection("general", false, false)).toBeUndefined();
  });

});
