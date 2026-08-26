import { expect, test } from "@playwright/test";

test("renders the anonymous memory platform landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /에이전트가 기억하고/ })
  ).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await expect(page.getByText("Long-term Memory")).toBeVisible();
  await expect(page.getByText("Hybrid RAG")).toBeVisible();
  await expect(page.getByText("Knowledge Graph", { exact: true })).toBeVisible();
  await expect(page.getByText("Scoped Access")).toBeVisible();
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
});

test("allows changing the color scheme", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "테마 전환" }).click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    /light|dark/
  );
});

test("shows the local self-signup form when enabled", async ({ page }) => {
  await page.goto("/");

  await page.getByText("가입", { exact: true }).click();

  await expect(page.getByLabel("이름")).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 만들기" })).toBeVisible();
});
