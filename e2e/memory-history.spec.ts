import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { resetInstallationFixture } from "./installation-fixture";

test("loads history on demand, isolates failures and reaches versions beyond the first hundred", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable PostgreSQL database");
  test.setTimeout(90_000);
  await resetInstallationFixture();
  const headers = { Origin: "http://127.0.0.1:3110", "x-forwarded-for": "192.0.2.93" };
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: {
      email: `e2e+${process.env.E2E_RUN_ID}-${testInfo.retry}@nalbam.com`,
      name: "History Operator",
      password: "agent-memory-e2e-password"
    }
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/memories");
  const created = await page.request.post("/api/memories", {
    headers,
    data: { kind: "fact", scope: { kind: "user" }, title: "History pagination fixture", content: "Stored revision 1", source: { type: "user" } }
  });
  expect(created.status()).toBe(201);
  const memory = await created.json() as { id: string };
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    // Seed only a long revision history; all reads and pagination use the real HTTP route.
    await database.query(`
      INSERT INTO memory_versions
        (organization_id, memory_id, version, title, content, source_type, valid_from, status, changed_by)
      SELECT organization_id, memory_id, sequence.version, title, 'Stored revision ' || sequence.version,
        source_type, valid_from, status, changed_by
      FROM memory_versions CROSS JOIN generate_series(2, 102) AS sequence(version)
      WHERE memory_id = $1 AND memory_versions.version = 1
    `, [memory.id]);
    await database.query("UPDATE memories SET current_version = 102, content = 'Stored revision 102' WHERE id = $1", [memory.id]);
  } finally {
    await database.end();
  }

  const requestedCursors: (number | null)[] = [];
  const firstRequest = Promise.withResolvers<void>();
  const releaseFirstRequest = Promise.withResolvers<void>();
  let failSecondPage = true;
  let unavailableStatus: 403 | 404 | undefined;
  await page.route(`**/api/memories/${memory.id}/versions?*`, async (route) => {
    const parameters = new URL(route.request().url()).searchParams;
    expect(parameters.get("limit")).toBe("25");
    const before = parameters.has("before") ? Number(parameters.get("before")) : null;
    requestedCursors.push(before);
    if (requestedCursors.length === 1) {
      firstRequest.resolve();
      await releaseFirstRequest.promise;
      await route.fulfill({ status: 503, json: { error: "History temporarily unavailable" } });
    } else if (before === 78 && failSecondPage) {
      failSecondPage = false;
      await route.fulfill({ status: 503, json: { error: "Older history temporarily unavailable" } });
    } else if (before === 78 && unavailableStatus !== undefined) {
      const status = unavailableStatus;
      unavailableStatus = undefined;
      await route.fulfill({ status, json: { error: "Synthetic history access failure" } });
    } else {
      await route.continue();
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/memories?memory=${memory.id}`);
  const detail = page.getByRole("region", { name: "Content and source", exact: true });
  await expect(detail.getByText("Stored revision 102", { exact: true })).toBeVisible();
  expect(requestedCursors).toEqual([]);

  await detail.getByRole("tab", { name: "Version history", exact: true }).click();
  await firstRequest.promise;
  await expect(detail.getByRole("status")).toHaveText("Loading version history");
  releaseFirstRequest.resolve();
  await expect(detail.getByRole("alert")).toContainText("History temporarily unavailable");
  await detail.getByRole("tab", { name: "Content and source", exact: true }).click();
  await expect(detail.getByText("Stored revision 102", { exact: true })).toBeVisible();
  await expect(detail.getByRole("tab", { name: "Edit", exact: true })).toBeVisible();

  await detail.getByRole("tab", { name: "Version history", exact: true }).click();
  const history = detail.getByRole("tabpanel", { name: "Version history", exact: true });
  await expect(history.getByText("v78", { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Load older versions", exact: true }).click();
  await expect(history.getByRole("alert")).toContainText("Older history temporarily unavailable");
  await expect(history.getByText("v78", { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Retry history", exact: true }).click();
  await expect(history.getByText("v53", { exact: true })).toBeVisible();
  for (const oldest of [28, 3, 1]) {
    await history.getByRole("button", { name: "Load older versions", exact: true }).click();
    await expect(history.getByText(`v${oldest}`, { exact: true })).toBeVisible();
  }
  await expect(history.getByRole("button", { name: "Load older versions", exact: true })).toHaveCount(0);
  await expect(history.getByText(/^v\d+$/)).toHaveCount(102);
  expect(requestedCursors).toEqual([null, null, 78, 78, 53, 28, 3]);

  for (const status of [403, 404] as const) {
    const firstRequestIndex = requestedCursors.length;
    await detail.getByRole("tab", { name: "Content and source", exact: true }).click();
    await detail.getByRole("tab", { name: "Version history", exact: true }).click();
    await expect(history.getByText(/^v\d+$/)).toHaveCount(25);
    unavailableStatus = status;
    await history.getByRole("button", { name: "Load older versions", exact: true }).click();
    await expect(history.getByRole("alert")).toContainText("This Memory is unavailable or you no longer have access.");
    await expect(history.getByText(/^v\d+$/)).toHaveCount(0);
    await expect(history.getByRole("button", { name: "Load older versions", exact: true })).toHaveCount(0);
    await history.getByRole("button", { name: "Retry history", exact: true }).click();
    await expect(history.getByText("v102", { exact: true })).toBeVisible();
    await expect(history.getByText("v78", { exact: true })).toBeVisible();
    await expect(history.getByText(/^v\d+$/)).toHaveCount(25);
    for (const oldest of [53, 28, 3, 1]) {
      await history.getByRole("button", { name: "Load older versions", exact: true }).click();
      await expect(history.getByText(`v${oldest}`, { exact: true })).toBeVisible();
    }
    await expect(history.getByRole("button", { name: "Load older versions", exact: true })).toHaveCount(0);
    await expect(history.getByText(/^v\d+$/)).toHaveCount(102);
    expect(requestedCursors.slice(firstRequestIndex)).toEqual([null, 78, null, 78, 53, 28, 3]);
  }
  expect(errors).toEqual([]);
});
