import { Client } from "pg";

export async function resetInstallationFixture() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/_(e2e|test)$/.test(new URL(databaseUrl).pathname.slice(1))) {
    throw new Error("Installation fixtures require an explicit disposable DATABASE_URL ending in _e2e or _test");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("TRUNCATE organizations, users CASCADE");
  } finally {
    await client.end();
  }
}
