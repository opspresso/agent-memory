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
  await expect(
    page.getByText("인증 제공자가 설정되지 않았습니다.", { exact: false })
  ).toBeVisible();
});

test("allows changing the color scheme", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "테마 전환" }).click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    /light|dark/
  );
});
