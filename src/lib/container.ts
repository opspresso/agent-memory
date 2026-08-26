import { createDatabase } from "@/infrastructure/database/client";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";

const defaultDatabaseUrl =
  "postgresql://agent_memory:agent_memory@localhost:5433/agent_memory";

export const database = createDatabase(
  process.env.DATABASE_URL ?? defaultDatabaseUrl
);

export const organizationAccessRepository =
  createOrganizationAccessRepository(database.db);
