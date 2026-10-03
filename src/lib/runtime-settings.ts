import { createAppSettingsUseCases } from "@/application/settings/manage-app-settings";
import { appSettingDefinitions } from "@/domain/settings/app-settings";
import { createAppSettingsRepository } from "@/infrastructure/database/repositories/app-settings-repository";
import { createAppSettingsSecretCipher } from "@/infrastructure/security/app-settings-secret";

import { getAdminEmails, getAllowedEmailDomains } from "./access-control";
import { database } from "./database";
import { validateRuntimeEnvironment } from "./runtime-configuration";
import { readEmbeddingMinimumScore } from "./embedding-configuration";

const environmentSymbol = Symbol.for("agent-memory.runtime-settings.base-environment");
const runtimeGlobal = globalThis as typeof globalThis & {
  [environmentSymbol]?: Readonly<Record<string, string | undefined>>;
};
// Instrumentation and route bundles must share the pre-override environment.
const baseEnvironment = runtimeGlobal[environmentSymbol] ??= Object.freeze({ ...process.env });
const settingsSecret = baseEnvironment.BETTER_AUTH_SECRET;
const settingsRepository = createAppSettingsRepository(database.db);
const settingsCipher = createAppSettingsSecretCipher(() => settingsSecret);
const cacheTtlMilliseconds = 5_000;

export const appSettingsUseCases = createAppSettingsUseCases({
  cipher: settingsCipher,
  clock: () => new Date(),
  environment: baseEnvironment,
  repository: settingsRepository,
  validate: validateRuntimeEnvironment
});

let cache:
  | {
      readonly environment: Readonly<Record<string, string | undefined>>;
      readonly fetchedAt: number;
    }
  | undefined;

let cacheGeneration = 0;
let pendingRead: Promise<Readonly<Record<string, string | undefined>>> | undefined;

export function invalidateRuntimeSettingsCache(): void {
  cacheGeneration += 1;
  cache = undefined;
  pendingRead = undefined;
}

export async function getEffectiveRuntimeEnvironment(): Promise<
  Readonly<Record<string, string | undefined>>
> {
  if (cache && Date.now() - cache.fetchedAt <= cacheTtlMilliseconds) {
    return cache.environment;
  }
  if (pendingRead) {
    return pendingRead;
  }

  const generation = cacheGeneration;
  const read = (async () => {
    const environment = await appSettingsUseCases.getEffectiveEnvironment();
    if (generation !== cacheGeneration) {
      return getEffectiveRuntimeEnvironment();
    }
    cache = {
      environment,
      fetchedAt: Date.now()
    };
    return environment;
  })();
  pendingRead = read;
  try {
    return await read;
  } finally {
    // An invalidation may already have started a newer read.
    if (pendingRead === read) {
      pendingRead = undefined;
    }
  }
}

async function applyRuntimeSettingsOverridesMatching(
  include: (restartRequired: boolean) => boolean
): Promise<void> {
  invalidateRuntimeSettingsCache();
  const environment = await getEffectiveRuntimeEnvironment();
  validateRuntimeEnvironment(environment);
  for (const definition of appSettingDefinitions) {
    if (!include(definition.restartRequired)) {
      continue;
    }
    const value = environment[definition.name];
    if (value === undefined) {
      delete process.env[definition.name];
    } else {
      process.env[definition.name] = value;
    }
  }
}

export async function applyRuntimeSettingsOverrides(): Promise<void> {
  await applyRuntimeSettingsOverridesMatching(() => true);
}

export async function applyLiveRuntimeSettingsOverrides(): Promise<void> {
  await applyRuntimeSettingsOverridesMatching(
    (restartRequired) => !restartRequired
  );
}

export async function getEffectiveAllowedEmailDomains(): Promise<readonly string[]> {
  return getAllowedEmailDomains(await getEffectiveRuntimeEnvironment());
}

export async function getEffectiveAdminEmails(): Promise<readonly string[]> {
  return getAdminEmails(await getEffectiveRuntimeEnvironment());
}

export async function getEffectiveEmbeddingMinimumScore(): Promise<number> {
  return readEmbeddingMinimumScore(await getEffectiveRuntimeEnvironment());
}
