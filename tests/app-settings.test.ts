import { describe, expect, it } from "vitest";

import {
  InvalidAppSettingsError,
  createAppSettingsUseCases
} from "@/application/settings/manage-app-settings";
import type {
  AppSettingName,
  AppSettings,
  AppSettingsRepository,
  AppSettingsSecretCipher
} from "@/domain/settings/app-settings";
import { createAppSettingsSecretCipher } from "@/infrastructure/security/app-settings-secret";

function dependencies(environment: Readonly<Record<string, string | undefined>>) {
  let stored: AppSettings | null = null;
  const repository: AppSettingsRepository = {
    async get() {
      return stored;
    },
    async save(settings) {
      stored = settings;
      return settings;
    }
  };
  const cipher: AppSettingsSecretCipher = {
    decrypt(value) {
      return value.replace(/^encrypted:/, "");
    },
    encrypt(value) {
      return `encrypted:${value}`;
    },
    isMasked(value) {
      return value.startsWith("masked:");
    },
    mask() {
      return "masked:••••••••";
    }
  };
  return {
    stored: () => stored,
    useCases: createAppSettingsUseCases({
      cipher,
      clock: () => new Date("2026-09-07T00:00:00.000Z"),
      environment,
      repository,
      validate: () => undefined
    })
  };
}

describe("application settings", () => {
  it("shows environment values and stores overrides with higher precedence", async () => {
    const { stored, useCases } = dependencies({
      ADMIN_EMAILS: "admin@example.com",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      GOOGLE_CLIENT_SECRET: "environment-secret"
    });

    await expect(useCases.getView()).resolves.toMatchObject({
      fields: {
        ALLOWED_EMAIL_DOMAINS: { value: "example.com", source: "env" },
        GOOGLE_CLIENT_SECRET: { value: "masked:••••••••", source: "env" }
      }
    });

    await useCases.update(
      {
        values: {
          ADMIN_EMAILS: "admin@example.com",
          ALLOWED_EMAIL_DOMAINS: "corp.example, example.com",
          GOOGLE_CLIENT_SECRET: "replacement-secret"
        }
      },
      "admin@example.com"
    );

    expect(stored()?.overrides).toMatchObject({
      ALLOWED_EMAIL_DOMAINS: "corp.example, example.com",
      GOOGLE_CLIENT_SECRET: "encrypted:replacement-secret"
    });
    await expect(useCases.getEffectiveEnvironment()).resolves.toMatchObject({
      ALLOWED_EMAIL_DOMAINS: "corp.example, example.com",
      GOOGLE_CLIENT_SECRET: "replacement-secret"
    });
  });

  it("supports an explicit empty domain override and a separate env reset", async () => {
    const { stored, useCases } = dependencies({
      ADMIN_EMAILS: "admin@example.com",
      ALLOWED_EMAIL_DOMAINS: "example.com"
    });
    await useCases.update(
      { values: { ALLOWED_EMAIL_DOMAINS: "" } },
      "admin@example.com"
    );
    expect(stored()?.overrides.ALLOWED_EMAIL_DOMAINS).toBe("");
    await expect(useCases.getEffectiveEnvironment()).resolves.toMatchObject({
      ALLOWED_EMAIL_DOMAINS: ""
    });

    await useCases.update(
      { reset: ["ALLOWED_EMAIL_DOMAINS"] },
      "admin@example.com"
    );
    expect(stored()?.overrides.ALLOWED_EMAIL_DOMAINS).toBeUndefined();
    await expect(useCases.getEffectiveEnvironment()).resolves.toMatchObject({
      ALLOWED_EMAIL_DOMAINS: "example.com"
    });
  });

  it("prevents an administrator from removing their own bootstrap access", async () => {
    const { useCases } = dependencies({ ADMIN_EMAILS: "admin@example.com" });

    await expect(
      useCases.update(
        { values: { ADMIN_EMAILS: "other@example.com" } },
        "admin@example.com"
      )
    ).rejects.toBeInstanceOf(InvalidAppSettingsError);
  });

  it("prevents an administrator from excluding their own sign-in domain", async () => {
    const { useCases } = dependencies({ ADMIN_EMAILS: "admin@example.com" });

    await expect(
      useCases.update(
        { values: { ALLOWED_EMAIL_DOMAINS: "other.example" } },
        "admin@example.com"
      )
    ).rejects.toThrow("ALLOWED_EMAIL_DOMAINS must include your email domain");
  });

  it("uses the development admin default when no env override is present", async () => {
    const { useCases } = dependencies({});

    await expect(
      useCases.update(
        { values: { ALLOWED_EMAIL_DOMAINS: "" } },
        "me@nalbam.com"
      )
    ).resolves.toMatchObject({
      fields: {
        ALLOWED_EMAIL_DOMAINS: { source: "override", value: "" }
      }
    });
  });

  it("encrypts secret overrides with field-bound authenticated encryption", () => {
    const cipher = createAppSettingsSecretCipher(
      () => "test-better-auth-secret-with-at-least-32-characters"
    );
    const name: AppSettingName = "GOOGLE_CLIENT_SECRET";
    const encrypted = cipher.encrypt("client-secret", name);

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("client-secret");
    expect(cipher.decrypt(encrypted, name)).toBe("client-secret");
    expect(() => cipher.decrypt(encrypted, "OIDC_CLIENT_SECRET")).toThrow();
  });
});
