import { eq, sql } from "drizzle-orm";

import type {
  AppSettings,
  AppSettingsRepository
} from "@/domain/settings/app-settings";
import type { AgentMemoryDatabase } from "@/infrastructure/database/client";
import { appSettings } from "@/infrastructure/database/schema";

export function createAppSettingsRepository(
  database: Pick<AgentMemoryDatabase, "select" | "insert" | "transaction">
): AppSettingsRepository {
  return {
    async update(mutate) {
      return database.transaction(async (transaction) => {
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(173529, 1)`);
        const repository = createAppSettingsRepository(transaction);
        return repository.save(mutate(await repository.get()));
      });
    },
    async get() {
      const [settings] = await database
        .select()
        .from(appSettings)
        .where(eq(appSettings.id, 1))
        .limit(1);
      return settings ?? null;
    },
    async save(settings: AppSettings) {
      const [saved] = await database
        .insert(appSettings)
        .values({ id: 1, ...settings })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: {
            overrides: settings.overrides,
            updatedAt: settings.updatedAt
          }
        })
        .returning();
      if (!saved) {
        throw new Error("App settings were not saved");
      }
      return saved;
    }
  };
}
