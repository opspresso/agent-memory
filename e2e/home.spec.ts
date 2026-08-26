import { expect, test } from "@playwright/test";

test("renders the anonymous memory platform landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Agents remember/ })
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await expect(page.getByText("Long-term Memory", { exact: true })).toBeVisible();
  await expect(page.getByText("Hybrid RAG", { exact: true })).toBeVisible();
  await expect(page.getByText("Knowledge Graph", { exact: true })).toBeVisible();
  await expect(page.getByText("Flexible Sharing")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Agent Memory logo" })
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true })
  ).toBeVisible();
});

test("switches to Korean and keeps the preference across pages", async ({
  page
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByRole("menuitem", { name: "한국어" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(
    page.getByRole("heading", { name: /에이전트가 기억하고/ })
  ).toBeVisible();
  await page.getByRole("link", { name: "가이드" }).click();
  await expect(
    page.getByRole("heading", { name: "기억을 넣는 법보다, 다시 믿고 쓰는 법." })
  ).toBeVisible();
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
