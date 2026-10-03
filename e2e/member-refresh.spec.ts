import { expect, test } from "@playwright/test";

import { resetInstallationFixture } from "./installation-fixture";

test("keeps member mutations newer than delayed refreshes and clears recovered load errors", async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable PostgreSQL database");
  test.setTimeout(90_000);
  await resetInstallationFixture();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const runId = `${process.env.E2E_RUN_ID}-${testInfo.retry}`;
  const memberEmail = `member-refresh+${runId}@nalbam.com`;
  const headers = { Origin: "http://127.0.0.1:3110", "x-forwarded-for": "192.0.2.94" };
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: { email: `e2e+${runId}@nalbam.com`, name: "Member Operator", password: "agent-memory-e2e-password" }
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Unified search", exact: true })).toBeVisible();

  const memberContext = await browser.newContext();
  let memberId: string;
  try {
    const member = await memberContext.request.post("/api/auth/sign-up/email", {
      headers: { ...headers, "x-forwarded-for": "192.0.2.95" },
      data: { email: memberEmail, name: "Refresh Member", password: "agent-memory-e2e-password" }
    });
    expect(member.ok()).toBe(true);
    memberId = (await member.json() as { user: { id: string } }).user.id;
    const memberPage = await memberContext.newPage();
    await memberPage.goto("/");
    await expect(memberPage.getByText("Your membership is awaiting approval by an organization administrator.", { exact: true })).toBeVisible();
  } finally {
    await memberContext.close();
  }
  const createdTeam = await page.request.post("/api/teams", {
    headers,
    data: { name: "Refresh Team", slug: `member-refresh-${testInfo.retry}` }
  });
  expect(createdTeam.status()).toBe(201);
  const team = await createdTeam.json() as { id: string };
  await page.goto("/members");
  const row = page.getByRole("row").filter({ hasText: memberEmail });
  await expect(row.getByText("Pending", { exact: true })).toBeVisible();

  for (const stage of [
    { path: "/api/members", action: "Approve", status: "Active" },
    { path: `/api/teams/${team.id}/members`, action: "Block", status: "Blocked" }
  ]) {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const delivered = Promise.withResolvers<void>();
    let delayNext = true;
    const pattern = `**${stage.path}`;
    await page.route(pattern, async (route) => {
      if (route.request().method() !== "GET" || !delayNext) {
        await route.continue();
        return;
      }
      delayNext = false;
      const response = await route.fetch();
      started.resolve();
      await release.promise;
      await route.fulfill({ response });
      delivered.resolve();
    });
    try {
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await started.promise;
      if (stage.action === "Approve") {
        await row.getByRole("button", { name: "Approve", exact: true }).click();
      } else {
        await row.getByRole("button", { name: `Actions for ${memberEmail}`, exact: true }).click();
        await page.getByRole("menuitem", { name: "Block", exact: true }).click();
      }
      await expect(row.getByText(stage.status, { exact: true })).toBeVisible();
      release.resolve();
      await delivered.promise;
      await page.waitForLoadState("networkidle");
      await expect(row.getByText(stage.status, { exact: true })).toBeVisible();
    } finally {
      release.resolve();
      await page.unroute(pattern);
    }
    if (stage.action === "Approve") {
      expect((await page.request.put(`/api/teams/${team.id}/members`, {
        headers, data: { email: memberEmail, role: "member" }
      })).ok()).toBe(true);
    }
  }
  const members = await (await page.request.get("/api/members")).json() as { members: { userId: string; status: string }[] };
  expect(members.members.find((member) => member.userId === memberId)?.status).toBe("blocked");

  await page.route("**/api/members", (route) => route.fulfill({ status: 503, json: { error: "Member list temporarily unavailable" } }), { times: 1 });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Member list temporarily unavailable" })).toBeVisible();
  // Locale changes reload the list without the Refresh handler clearing the previous error.
  await page.getByRole("button", { name: "Change language", exact: true }).click();
  await page.getByRole("menuitem", { name: "한국어", exact: true }).click();
  await expect(row.getByText("차단됨", { exact: true })).toBeVisible();
  await expect(page.getByText("Member list temporarily unavailable", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
