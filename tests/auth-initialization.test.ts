import { expect, it } from "vitest";

import { createDatabase } from "@/infrastructure/database/client";
import { createAuth } from "@/lib/create-auth";

it("initializes authentication and resolves an anonymous session with the application schema", async () => {
  // An anonymous session needs schema validation but no database connection.
  const database = createDatabase("postgresql://localhost:1/agent_memory_test");
  try {
    const auth = createAuth({
      baseURL: "http://localhost:3100",
      database: database.db,
      secret: "agent-memory-unit-test-secret-000000000000",
      emailAndPassword: { allowSignUp: true },
      includeNextCookies: false
    });

    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
  } finally {
    await database.pool.end();
  }
});
