import { defineConfig } from "drizzle-kit";

export default defineConfig({
  casing: "snake_case",
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/infrastructure/database/schema/index.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://agent_memory:agent_memory@localhost:5433/agent_memory"
  },
  strict: true,
  verbose: true
});
