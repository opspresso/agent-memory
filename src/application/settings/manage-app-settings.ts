import {
  appSettingDefinitions,
  type AppSettingName,
  type AppSettings,
  type AppSettingsRepository,
  type AppSettingsSecretCipher
} from "@/domain/settings/app-settings";

export interface AppSettingFieldView {
  readonly value: string;
  readonly source: "override" | "env" | "default" | "unset";
  readonly secret: boolean;
  readonly restartRequired: boolean;
}

export interface AppSettingsView {
  readonly fields: Readonly<Record<AppSettingName, AppSettingFieldView>>;
  readonly updatedAt?: string;
}

export interface AppSettingsUpdate {
  readonly reset?: readonly AppSettingName[];
  readonly values?: Readonly<Partial<Record<AppSettingName, string>>>;
}

export class InvalidAppSettingsError extends Error {}

interface Dependencies {
  readonly cipher: AppSettingsSecretCipher;
  readonly clock: () => Date;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly repository: AppSettingsRepository;
  readonly validate: (
    environment: Readonly<Record<string, string | undefined>>
  ) => void;
}

function fieldValue(
  name: AppSettingName,
  settings: AppSettings | null,
  dependencies: Dependencies
): string | undefined {
  const stored = settings?.overrides[name];
  if (stored === undefined) {
    return dependencies.environment[name];
  }
  const definition = appSettingDefinitions.find((candidate) => candidate.name === name);
  return definition && "secret" in definition && definition.secret
    ? dependencies.cipher.decrypt(stored, name)
    : stored;
}

function effectiveEnvironment(
  settings: AppSettings | null,
  dependencies: Dependencies
): Readonly<Record<string, string | undefined>> {
  const effective = { ...dependencies.environment };
  for (const definition of appSettingDefinitions) {
    const value = fieldValue(definition.name, settings, dependencies);
    if (value === undefined) {
      delete effective[definition.name];
    } else {
      effective[definition.name] = value;
    }
  }
  return effective;
}

function toView(
  settings: AppSettings | null,
  dependencies: Dependencies
): AppSettingsView {
  const fields = {} as Record<AppSettingName, AppSettingFieldView>;
  for (const definition of appSettingDefinitions) {
    const stored = settings?.overrides[definition.name];
    const secret = "secret" in definition && definition.secret === true;
    if (stored !== undefined) {
      fields[definition.name] = {
        value: secret ? dependencies.cipher.mask(stored) : stored,
        source: "override",
        secret,
        restartRequired: definition.restartRequired
      };
      continue;
    }
    const environmentValue = dependencies.environment[definition.name];
    if (environmentValue !== undefined) {
      fields[definition.name] = {
        value: secret ? dependencies.cipher.mask(environmentValue) : environmentValue,
        source: "env",
        secret,
        restartRequired: definition.restartRequired
      };
      continue;
    }
    const defaultValue = "defaultValue" in definition
      ? definition.defaultValue
      : undefined;
    fields[definition.name] = {
      value: defaultValue ?? "",
      source: defaultValue === undefined ? "unset" : "default",
      secret,
      restartRequired: definition.restartRequired
    };
  }
  return {
    fields,
    ...(settings ? { updatedAt: settings.updatedAt.toISOString() } : {})
  };
}

function normalizedOverrides(
  current: AppSettings | null,
  update: AppSettingsUpdate,
  dependencies: Dependencies
): Partial<Record<AppSettingName, string>> {
  const next = { ...(current?.overrides ?? {}) };
  for (const name of update.reset ?? []) {
    delete next[name];
  }
  for (const [candidateName, candidateValue] of Object.entries(update.values ?? {})) {
    const name = candidateName as AppSettingName;
    const definition = appSettingDefinitions.find((candidate) => candidate.name === name);
    if (!definition || candidateValue === undefined) {
      continue;
    }
    const value = candidateValue.trim();
    const secret = "secret" in definition && definition.secret === true;
    if (secret && dependencies.cipher.isMasked(value)) {
      continue;
    }
    if (value === dependencies.environment[name]) {
      delete next[name];
    } else {
      next[name] = secret
        ? dependencies.cipher.encrypt(value, name)
        : value;
    }
  }
  return next;
}

export function createAppSettingsUseCases(dependencies: Dependencies) {
  return {
    async getView(): Promise<AppSettingsView> {
      return toView(await dependencies.repository.get(), dependencies);
    },
    async getEffectiveEnvironment(): Promise<Readonly<Record<string, string | undefined>>> {
      return effectiveEnvironment(await dependencies.repository.get(), dependencies);
    },
    async update(
      update: AppSettingsUpdate,
      userEmail: string
    ): Promise<AppSettingsView> {
      const saved = await dependencies.repository.update((current) => {
        const currentAdmins = (fieldValue("ADMIN_EMAILS", current, dependencies) ?? "me@nalbam.com")
          .split(",")
          .map((email) => email.trim().toLowerCase());
        if (!currentAdmins.includes(userEmail.trim().toLowerCase())) {
          throw new InvalidAppSettingsError("Application settings access denied");
        }
        const next: AppSettings = {
          overrides: normalizedOverrides(current, update, dependencies),
          updatedAt: dependencies.clock()
        };
        const effective = effectiveEnvironment(next, dependencies);
        try {
          dependencies.validate(effective);
        } catch (error) {
          throw new InvalidAppSettingsError(
            error instanceof Error ? error.message : "Invalid app settings"
          );
        }
        const adminDefinition = appSettingDefinitions.find(
          (definition) => definition.name === "ADMIN_EMAILS"
        );
        const admins = (
          effective.ADMIN_EMAILS ??
          (adminDefinition && "defaultValue" in adminDefinition
            ? adminDefinition.defaultValue
            : "")
        )
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean);
        if (!admins.includes(userEmail.trim().toLowerCase())) {
          throw new InvalidAppSettingsError(
            "ADMIN_EMAILS must include your email address"
          );
        }
        const allowedDomains = (effective.ALLOWED_EMAIL_DOMAINS ?? "")
          .split(",")
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean);
        const userDomain = userEmail.trim().toLowerCase().split("@")[1];
        if (
          allowedDomains.length > 0 &&
          (!userDomain || !allowedDomains.includes(userDomain))
        ) {
          throw new InvalidAppSettingsError(
            "ALLOWED_EMAIL_DOMAINS must include your email domain"
          );
        }
        return next;
      });
      return toView(saved, dependencies);
    }
  };
}
