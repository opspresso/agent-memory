import { expect, test, type Page } from "@playwright/test";

const authenticatedE2e = process.env.E2E_AUTHENTICATED === "true";

test("explains the product workflow in the public guide", async ({ page }) => {
  await page.goto("/guide");

  await expect(
    page.getByRole("heading", {
      name: "More than storing memory, make it trustworthy and reusable."
    })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Guide contents" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Follow relationships without losing the evidence." })
  ).toBeVisible();
  await expect(page.getByText("knowledge_neighborhood", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Console" })).toHaveAttribute(
    "href",
    "/"
  );
});

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
}, testInfo) => {
  test.skip(!authenticatedE2e, "requires a disposable migrated PostgreSQL database");
  test.setTimeout(60_000);
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID must be configured by Playwright");
  }
  const email = `e2e+${runId}-${testInfo.retry}@nalbam.com`;

  await page.context().addCookies([
    {
      name: "agent-memory-locale",
      value: "ko",
      domain: "127.0.0.1",
      path: "/"
    }
  ]);
  await page.goto("/");
  await page.getByText("가입", { exact: true }).click();
  await page.getByLabel("이름").fill("E2E Operator");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("agent-memory-e2e-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();

  await expect(page.getByRole("heading", { name: "첫 조직 만들기" })).toBeVisible();
  const organization = await postJson<{ id: string }>(
    page,
    "/api/organizations",
    {
      name: "E2E Organization",
      slug: `e2e-organization-${runId}-${testInfo.retry}`
    }
  );
  const team = await postJson<{ id: string }>(
    page,
    `/api/organizations/${organization.id}/teams`,
    { name: "E2E Team", slug: `e2e-team-${runId}-${testInfo.retry}` }
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "공유 Context를 한곳에서 관리합니다." })
  ).toBeVisible();
  const organizationId = organization.id;

  await page.getByRole("tab", { name: "문서 수집" }).click();
  await page.getByRole("combobox", { name: "공유 범위" }).click();
  await expect(
    page.getByRole("option", { name: "조직 · 모든 조직 멤버와 공유" })
  ).toBeVisible();
  await page.getByRole("option", { name: "팀 · 선택한 팀과 공유" }).click();
  await page.getByRole("combobox", { name: "공유할 팀" }).click();
  await page.getByRole("option", { name: "E2E Team" }).click();
  await page.getByLabel("문서 파일").setInputFiles({
    name: "team-guide.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Team guide")
  });
  await page.route(
    `**/api/organizations/${organizationId}/documents`,
    async (route) => {
      const payload = route.request().postData() ?? "";
      expect(payload).toContain('name="scopeKind"');
      expect(payload).toContain("team");
      expect(payload).toContain('name="teamId"');
      expect(payload).toContain(team.id);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "e2e-document", status: "pending" }),
        status: 202
      });
    }
  );
  await page.getByRole("button", { name: "수집 시작" }).click();
  await expect(page.getByText("수집 대기열에 등록했습니다: e2e-document")).toBeVisible();

  await page.getByRole("tab", { name: "Agent 연결" }).click();
  const mcpEndpoint = `${new URL(page.url()).origin}/api/organizations/${organizationId}/mcp`;
  await expect(page.getByText(mcpEndpoint, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "MCP endpoint 복사" }).click();
  await expect(page.getByRole("button", { name: "MCP endpoint 복사" })).toHaveText(
    "복사됨"
  );

  await page.getByRole("tab", { name: "통합 검색" }).click();

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
  await expect(lifecycle.getByText("Version 이력")).toBeVisible();
  await lifecycle
    .getByLabel("내용")
    .fill("Checkout rollback requires three approvers.");
  await lifecycle.getByLabel("변경 사유").fill("E2E revision verification");
  await lifecycle.getByRole("button", { name: "Revision 저장" }).click();
  await expect(lifecycle.getByText("새 revision을 저장했습니다.")).toBeVisible();
  await expect(lifecycle.getByText("v2 · 현재")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lifecycle).not.toBeVisible();

  const archivedDocumentId = "40000000-0000-0000-0000-000000000099";
  await page.route(
    `**/api/organizations/${organizationId}/documents?q=*`,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          hits: [
            {
              document: {
                id: archivedDocumentId,
                title: "Archived team guide",
                mimeType: "text/markdown",
                scope: { kind: "organization", organizationId }
              },
              chunk: { id: "chunk-1", ordinal: 0, content: "Team guide" },
              lexicalScore: 1,
              vectorScore: 0,
              score: 1
            }
          ]
        }),
        status: 200
      });
    }
  );
  await page.route(
    `**/api/organizations/${organizationId}/documents/${archivedDocumentId}`,
    async (route) => {
      expect(route.request().method()).toBe("DELETE");
      await route.fulfill({ status: 204 });
    }
  );
  await page.getByText("Documents", { exact: true }).click();
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("team guide");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Archived team guide")).toBeVisible();
  await page.getByRole("button", { name: "문서 Archive" }).click();
  const archiveDialog = page.getByRole("dialog", { name: "문서 Archive" });
  await archiveDialog.getByRole("button", { name: "Archive 확인" }).click();
  await expect(page.getByText("Archived team guide을 Archive했습니다.")).toBeVisible();
  await expect(page.getByText("Archived team guide", { exact: true })).not.toBeVisible();

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
  const edge = await postJson<{ id: string }>(
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
  await expect(page.getByLabel("Graph node 검색")).toBeVisible();
  await expect(page.getByRole("button", { name: "확대" })).toBeVisible();
  await page.getByRole("button", { name: "DATABASE Orders Database" }).click();
  await expect(page.getByText("← depends_on")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이 node 중심으로 탐색" })
  ).toBeVisible();
  const edgeDeleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(
        `/api/organizations/${organizationId}/knowledge/edges/${edge.id}`
      ) && response.request().method() === "DELETE"
  );
  await page.getByRole("button", { name: "관계 삭제" }).click();
  await page.getByRole("dialog", { name: "Graph resource 삭제" })
    .getByRole("button", { name: "삭제 확인" })
    .click();
  await edgeDeleteResponse;
  await expect(page.getByText("Graph에서 depends_on을 삭제했습니다.")).toBeVisible();

  const nodeDeleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(
        `/api/organizations/${organizationId}/knowledge/nodes/${secondNode.id}`
      ) && response.request().method() === "DELETE"
  );
  await page.getByRole("button", { name: "Node 삭제" }).click();
  await page.getByRole("dialog", { name: "Graph resource 삭제" })
    .getByRole("button", { name: "삭제 확인" })
    .click();
  await nodeDeleteResponse;
  await expect(page.getByText("Graph에서 Orders Database을 삭제했습니다.")).toBeVisible();

  await postJson(
    page,
    `/api/organizations/${organizationId}/knowledge/nodes`,
    {
      scope: { kind: "user" },
      kind: "concept",
      canonicalName: "Duplicate Entity",
      source: { memoryId: memory.id }
    }
  );
  await postJson(
    page,
    `/api/organizations/${organizationId}/knowledge/nodes`,
    {
      scope: { kind: "user" },
      kind: "service",
      canonicalName: "Duplicate Entity",
      source: { memoryId: memory.id }
    }
  );
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("Duplicate Entity");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Duplicate Entity", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "중복 병합" }).first().click();
  const mergeDialog = page.getByRole("dialog", { name: "중복 node 병합" });
  await mergeDialog.getByLabel("병합 사유").fill("E2E duplicate verification");
  await mergeDialog.getByRole("button", { name: "병합 확인" }).click();
  await expect(page.getByText("중복된 Duplicate Entity node를 병합했습니다.")).toBeVisible();
  await expect(page.getByText("Duplicate Entity", { exact: true })).toHaveCount(1);
});
