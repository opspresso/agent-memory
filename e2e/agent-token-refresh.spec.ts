import { expect, test } from "@playwright/test";
import { resetInstallationFixture } from "./installation-fixture";

test("keeps credential mutations newer than delayed status responses", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable authenticated test database");
  await resetInstallationFixture();
  await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { Origin: "http://127.0.0.1:3110", "x-forwarded-for": "192.0.2.96" },
    data: { email: `e2e+${process.env.E2E_RUN_ID}-${testInfo.retry}@nalbam.com`, name: "Token Operator", password: "agent-memory-e2e-password" }
  });
  expect(signup.ok()).toBe(true);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  const pattern = "**/api/agent-token";
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    expect((await response.json()).configured).toBe(false);
    started.resolve();
    await release.promise;
    await route.fulfill({ response });
    delivered.resolve();
  });
  try {
    await page.goto("/connect");
    await started.promise;
    await page.getByRole("button", { name: "Token 생성", exact: true }).click();
    await expect(page.getByRole("button", { name: "Token 숨기기", exact: true })).toBeVisible();
    release.resolve();
    await delivered.promise;
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Token 재생성", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Token 숨기기", exact: true })).toBeVisible();
  } finally {
    release.resolve();
    await page.unroute(pattern);
  }

  const refreshStarted = Promise.withResolvers<void>();
  const releaseRefresh = Promise.withResolvers<void>();
  const refreshDelivered = Promise.withResolvers<void>();
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    expect((await response.json()).configured).toBe(true);
    refreshStarted.resolve();
    await releaseRefresh.promise;
    await route.fulfill({ response });
    refreshDelivered.resolve();
  });
  try {
    await page.getByRole("button", { name: "언어 변경" }).click();
    await page.getByRole("menuitem", { name: "English", exact: true }).click();
    await refreshStarted.promise;
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke token", exact: true }).click();
    await expect(page.getByRole("button", { name: "Generate token", exact: true })).toBeVisible();
    releaseRefresh.resolve();
    await refreshDelivered.promise;
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Generate token", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke token", exact: true })).toHaveCount(0);
  } finally {
    releaseRefresh.resolve();
    await page.unroute(pattern);
  }

  const existing = await page.request.post("/api/agent-token", { headers: { Origin: "http://127.0.0.1:3110" } });
  expect(existing.status()).toBe(201);
  const existingStarted = Promise.withResolvers<void>();
  const releaseExisting = Promise.withResolvers<void>();
  let delayNextStatus = true;
  await page.route(pattern, async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 503, json: { error: "Token generation temporarily unavailable" } });
    }
    if (route.request().method() !== "GET" || !delayNextStatus) return route.continue();
    delayNextStatus = false;
    const response = await route.fetch();
    expect((await response.json()).configured).toBe(true);
    existingStarted.resolve();
    await releaseExisting.promise;
    await route.fulfill({ response });
  });
  try {
    await page.reload();
    await existingStarted.promise;
    await page.getByRole("button", { name: "Generate token", exact: true }).click();
    await expect(page.getByText("Token generation temporarily unavailable", { exact: true })).toBeVisible();
    releaseExisting.resolve();
    await expect(page.getByRole("button", { name: "Regenerate token", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke token", exact: true })).toBeVisible();
    await expect(page.getByText("Token generation temporarily unavailable", { exact: true })).toBeVisible();
  } finally {
    releaseExisting.resolve();
    await page.unroute(pattern);
  }
});
