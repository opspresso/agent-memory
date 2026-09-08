import { expect, test } from "@playwright/test";

test("renders the anonymous memory platform landing page", async ({ page }, testInfo) => {
  const response = await page.goto("/");

  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'"
  );
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin"
  );
  expect(response?.headers()["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=(), browsing-topics=()"
  );
  await expect(
    page.getByRole("heading", { name: /Agents remember/ })
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await expect(page.getByText("Long-term Memory", { exact: true })).toBeVisible();
  await expect(page.getByText("Hybrid RAG", { exact: true })).toBeVisible();
  await expect(page.getByText("Knowledge Graph", { exact: true })).toBeVisible();
  await expect(page.getByText("Flexible Sharing")).toBeVisible();
  await expect(page.getByText(/A self-hosted context platform for one organization/)).toBeVisible();
  await expect(page.getByText(/New signups are membership requests/)).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Agent Memory logo" })
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("home-desktop-en.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-mobile-en.png"), fullPage: true });
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true })
  ).toBeVisible();
});

test("hydrates with a stored color scheme", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" ||
      message.text().includes("Hydration failed") ||
      message.text().includes("Encountered a script tag")
    ) {
      hydrationErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => hydrationErrors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem("mantine-color-scheme-value", "light");
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Agents remember/ })
  ).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  expect(hydrationErrors).toEqual([]);
});

test("switches to Korean and keeps the preference across pages", async ({
  page
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitem", { name: "한국어" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByText("신규 가입은 가입 요청으로 처리됩니다. 운영자 승인 후 조직 지식을 사용할 수 있습니다.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /에이전트가 기억하고/ })
  ).toBeVisible();
  await page.getByRole("link", { name: "가이드" }).click();
  await expect(
    page.getByRole("heading", { name: "기억을 넣는 법보다, 다시 믿고 쓰는 법." })
  ).toBeVisible();
  await expect(page).toHaveTitle("사용 가이드 · Agent Memory");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("allows changing the color scheme", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Theme: System" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
});

test("shows the local self-signup form when enabled", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Sign up", { exact: true }).click();

  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});
