import { expect, test, type Page } from "@playwright/test";

const authenticatedE2e = process.env.E2E_AUTHENTICATED === "true";

async function postJson<T>(
  page: Page,
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  return page.evaluate(
    async ({ requestUrl, requestBody }) => {
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const value = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        throw new Error(value.error ?? `request failed with ${response.status}`);
      }
      return value;
    },
    { requestUrl: url, requestBody: body }
  );
}

test("manages memory lifecycle and explores grounded knowledge", async ({
  page
}) => {
  test.skip(!authenticatedE2e, "requires a disposable migrated PostgreSQL database");
  test.setTimeout(60_000);

  await page.goto("/");
  await page.getByText("가입", { exact: true }).click();
  await page.getByLabel("이름").fill("E2E Operator");
  await page.getByLabel("이메일").fill("e2e@nalbam.com");
  await page.getByLabel("비밀번호").fill("agent-memory-e2e-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();

  await expect(page.getByRole("heading", { name: "첫 조직 만들기" })).toBeVisible();
  const organization = await postJson<{ id: string }>(
    page,
    "/api/organizations",
    { name: "E2E Organization", slug: "e2e-organization" }
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "공유 Context를 한곳에서 관리합니다." })
  ).toBeVisible();
  const organizationId = organization.id;

  const memory = await postJson<{ id: string }>(
    page,
    `/api/organizations/${organizationId}/memories`,
    {
      kind: "decision",
      scope: { kind: "user" },
      title: "Checkout rollback policy",
      content: "Checkout rollback requires two approvers.",
      source: { type: "user" }
    }
  );

  await page.getByText("Memory", { exact: true }).click();
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("checkout rollback");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Checkout rollback policy")).toBeVisible();
  await page.getByRole("button", { name: "Lifecycle" }).click();

  const lifecycle = page.getByRole("dialog", { name: "Memory lifecycle" });
  await expect(lifecycle.getByText("Version spine")).toBeVisible();
  await lifecycle
    .getByLabel("내용")
    .fill("Checkout rollback requires three approvers.");
  await lifecycle.getByLabel("변경 사유").fill("E2E revision verification");
  await lifecycle.getByRole("button", { name: "Revision 저장" }).click();
  await expect(lifecycle.getByText("새 revision을 저장했습니다.")).toBeVisible();
  await expect(lifecycle.getByText("v2 · current")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lifecycle).not.toBeVisible();

  const firstNode = await postJson<{ id: string }>(
    page,
    `/api/organizations/${organizationId}/knowledge/nodes`,
    {
      scope: { kind: "user" },
      kind: "service",
      canonicalName: "Checkout API",
      summary: "Processes purchases",
      source: { memoryId: memory.id }
    }
  );
  const secondNode = await postJson<{ id: string }>(
    page,
    `/api/organizations/${organizationId}/knowledge/nodes`,
    {
      scope: { kind: "user" },
      kind: "database",
      canonicalName: "Orders Database",
      summary: "Stores checkout orders",
      source: { memoryId: memory.id }
    }
  );
  await postJson(
    page,
    `/api/organizations/${organizationId}/knowledge/edges`,
    {
      scope: { kind: "user" },
      sourceNodeId: firstNode.id,
      targetNodeId: secondNode.id,
      predicate: "depends_on",
      source: { memoryId: memory.id }
    }
  );

  await page.getByText("Graph", { exact: true }).click();
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("Checkout API");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Checkout API", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "관계 보기" }).first().click();
  await expect(page.getByText("Knowledge map")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "DATABASE Orders Database" })
  ).toBeVisible();
});
