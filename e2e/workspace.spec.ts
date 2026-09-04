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
  await expect(page.getByText("recall", { exact: true })).toBeVisible();
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

test("onboards, approves, and manages members through the console", async ({
  browser,
  page
}, testInfo) => {
  test.skip(!authenticatedE2e, "requires a disposable migrated PostgreSQL database");
  test.setTimeout(90_000);
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID must be configured by Playwright");
  }
  const adminEmail = `e2e-admin2+${runId}-${testInfo.retry}@nalbam.com`;
  const memberEmail = `e2e-member+${runId}-${testInfo.retry}@nalbam.com`;
  const password = "agent-memory-e2e-password";
  // Retries reuse the same database, so the display name must be unique
  // per attempt or the onboarding card locator matches stale organizations.
  const approvalOrganizationName = `E2E Approval Organization ${runId} R${testInfo.retry}`;

  await page.context().addCookies([
    { name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }
  ]);
  await page.goto("/");
  await page.getByText("가입", { exact: true }).click();
  await page.getByLabel("이름").fill("E2E Admin Two");
  await page.getByLabel("이메일").fill(adminEmail);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(
    page.getByRole("heading", { name: "참여할 조직을 선택하세요" })
  ).toBeVisible();

  const approvalOrganizationSlug = `e2e-approval-${runId}-${testInfo.retry}`;
  await postJson<{ id: string }>(
    page,
    "/api/organizations",
    {
      name: approvalOrganizationName,
      slug: approvalOrganizationSlug
    }
  );
  await postJson<{ id: string }>(
    page,
    `/api/organizations/${approvalOrganizationSlug}/teams`,
    { name: "E2E Default Team", slug: `e2e-default-${runId}-${testInfo.retry}` }
  );

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "조직 설정" })
  ).toBeVisible();
  await page.getByRole("combobox", { name: "신규 회원 정책" }).click();
  await page.getByRole("option", { name: "승인 대기" }).click();
  await page.getByRole("combobox", { name: "기본 팀" }).click();
  await page.getByRole("option", { name: "E2E Default Team" }).click();
  await page.getByRole("combobox", { name: "검증 모드" }).click();
  await page.getByRole("option", { name: "경고 · 미등록 용어 표시" }).click();
  await page.getByRole("combobox", { name: "Node kind 사전" }).fill("Service");
  await page.keyboard.press("Enter");
  await page.getByRole("combobox", { name: "Node kind 사전" }).fill("Award");
  await page.keyboard.press("Enter");
  await page
    .getByRole("combobox", { name: "Edge predicate 사전" })
    .fill("depends_on");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.getByText("설정을 저장했습니다.")).toBeVisible();
  await expect(page.getByText("recognition", { exact: true })).toBeVisible();
  await expect(page.getByText("award", { exact: true })).not.toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "검증 모드" })
  ).toHaveValue("경고 · 미등록 용어 표시");
  await expect(page.getByText("service", { exact: true })).toBeVisible();
  await expect(page.getByText("recognition", { exact: true })).toBeVisible();
  await expect(page.getByText("depends_on", { exact: true })).toBeVisible();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberContext.addCookies([
    { name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }
  ]);
  await memberPage.goto("/");
  await memberPage.getByText("가입", { exact: true }).click();
  await memberPage.getByLabel("이름").fill("E2E Member");
  await memberPage.getByLabel("이메일").fill(memberEmail);
  await memberPage.getByLabel("비밀번호").fill(password);
  await memberPage.getByRole("button", { name: "계정 만들기" }).click();
  await expect(
    memberPage.getByRole("heading", { name: "참여할 조직을 선택하세요" })
  ).toBeVisible();
  await memberPage
    .locator(".mantine-Paper-root", { hasText: approvalOrganizationName })
    .getByRole("button", { name: "가입" })
    .click();
  await expect(
    memberPage.getByText("조직 관리자의 승인을 기다리고 있습니다.")
  ).toBeVisible();

  await page.goto("/members");
  await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();
  await expect(page.getByText("승인 대기", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "승인" }).click();
  await expect(page.getByText("회원을 승인했습니다.")).toBeVisible();
  await expect(page.getByText("E2E Default Team").first()).toBeVisible();

  await memberPage.goto("/");
  await expect(
    memberPage.getByRole("heading", { name: "공유 Context를 한곳에서 관리합니다." })
  ).toBeVisible();

  const secondOrganizationName = `E2E Second Organization ${runId} R${testInfo.retry}`;
  await postJson<{ id: string }>(page, "/api/organizations", {
    name: secondOrganizationName,
    slug: `e2e-second-${runId}-${testInfo.retry}`
  });
  await memberPage.getByRole("button", { name: "계정 메뉴" }).click();
  await memberPage.getByRole("menuitem", { name: "다른 조직 가입" }).click();
  await expect(
    memberPage.getByRole("heading", { name: "참여할 조직을 선택하세요" })
  ).toBeVisible();
  await memberPage
    .locator(".mantine-Paper-root", { hasText: secondOrganizationName })
    .getByRole("button", { name: "가입" })
    .click();
  await expect(
    memberPage.getByText("조직 관리자의 승인을 기다리고 있습니다.")
  ).toBeVisible();

  await page.getByRole("button", { name: `${memberEmail}에 대한 작업` }).click();
  await page.getByRole("menuitem", { name: "차단" }).click();
  await expect(page.getByText("회원을 차단했습니다.")).toBeVisible();
  await expect(page.getByText("차단됨", { exact: true })).toBeVisible();

  await memberContext.close();
});

test("manages memory lifecycle and explores grounded knowledge", async ({
  page
}, testInfo) => {
  test.skip(!authenticatedE2e, "requires a disposable migrated PostgreSQL database");
  test.setTimeout(90_000);
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

  await expect(
    page.getByRole("heading", { name: "참여할 조직을 선택하세요" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "첫 조직 만들기" })).toBeVisible();
  const organizationSlug = `e2e-organization-${runId}-${testInfo.retry}`;
  const organization = await postJson<{ id: string }>(
    page,
    "/api/organizations",
    {
      name: "E2E Organization",
      slug: organizationSlug
    }
  );
  const team = await postJson<{ id: string }>(
    page,
    `/api/organizations/${organizationSlug}/teams`,
    { name: "E2E Team", slug: `e2e-team-${runId}-${testInfo.retry}` }
  );
  await postJson<{ id: string }>(page, "/api/organizations", {
    name: "E2E Other Organization",
    slug: `e2e-other-organization-${runId}-${testInfo.retry}`
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "공유 Context를 한곳에서 관리합니다." })
  ).toBeVisible();
  const organizationId = organization.id;

  await page.getByRole("link", { name: "문서 수집" }).click();
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
    `**/api/organizations/${organizationSlug}/documents`,
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
  await page.getByRole("combobox", { name: "활성 조직" }).click();
  await page.getByRole("option", { name: "E2E Other Organization" }).click();
  await expect(
    page.getByText("수집 대기열에 등록했습니다: e2e-document")
  ).not.toBeVisible();
  await page.getByRole("combobox", { name: "활성 조직" }).click();
  await page.getByRole("option", { name: "E2E Organization" }).click();

  await page.getByRole("link", { name: "Agent 연결" }).click();
  const mcpEndpoint = `${new URL(page.url()).origin}/api/organizations/${organizationSlug}/mcp`;
  await expect(page.getByText(mcpEndpoint, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "MCP endpoint 복사" }).click();
  await expect(page.getByRole("button", { name: "MCP endpoint 복사" })).toHaveText(
    "복사됨"
  );
  await page.getByRole("button", { name: "Token 생성" }).click();
  const authorization = await page
    .getByText(/^Bearer amt_[A-Za-z0-9_-]{43}$/)
    .textContent();
  expect(authorization).toBeTruthy();
  await page.getByRole("button", { name: "Token 숨기기" }).click();
  await expect(page.getByText(authorization!, { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Token 보기" }).click();
  await expect(page.getByText(authorization!, { exact: true })).toBeVisible();
  const initializeResponse = await page.request.post(mcpEndpoint, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-memory-e2e", version: "1.0.0" }
      }
    },
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: authorization!,
      "Content-Type": "application/json"
    }
  });
  expect(initializeResponse.ok()).toBe(true);

  const candidateId = "80000000-0000-4000-8000-000000000099";
  let duplicateRequests = 0;
  await page.route(
    `**/api/organizations/${organizationSlug}/knowledge/candidates?limit=100`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [
            {
              id: candidateId,
              documentId: "40000000-0000-4000-8000-000000000098",
              chunkId: "50000000-0000-4000-8000-000000000098",
              model: "e2e-extractor",
              scope: {
                kind: "user",
                organizationId,
                userId: "10000000-0000-4000-8000-000000000098"
              },
              graph: {
                entities: [
                  { key: "api", kind: "service", canonicalName: "Agent API" },
                  { key: "db", kind: "database", canonicalName: "Agent DB" }
                ],
                relationships: []
              },
              createdAt: "2026-08-27T00:00:00.000Z"
            }
          ]
        }),
        status: 200
      })
  );
  await page.route(
    `**/api/organizations/${organizationSlug}/knowledge/candidates/${candidateId}/duplicates`,
    (route) => {
      duplicateRequests += 1;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          duplicates: {
            api: [
              {
                id: "60000000-0000-4000-8000-000000000098",
                kind: "service",
                canonicalName: "Agent API",
                scope: {
                  kind: "user",
                  organizationId,
                  userId: "10000000-0000-4000-8000-000000000098"
                }
              }
            ],
            db: []
          },
          ontology: {
            mode: "warn",
            violations: [{ type: "unknown_kind", term: "database" }]
          }
        }),
        status: 200
      });
    }
  );
  await page.getByRole("link", { name: "AI 후보 검토" }).click();
  await expect(
    page.getByText(/같은 scope와 이름의 기존 node가 1개 있습니다/)
  ).toBeVisible();
  await expect(page.getByText("온톨로지에 없음", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/온톨로지 사전에 없는 용어가 포함되어 있습니다: database/)
  ).toBeVisible();
  expect(duplicateRequests).toBe(1);

  await page.getByRole("link", { name: "통합 검색" }).click();

  const memory = await postJson<{ id: string }>(
    page,
    `/api/organizations/${organizationSlug}/memories`,
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
    `**/api/organizations/${organizationSlug}/documents?q=*`,
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
    `**/api/organizations/${organizationSlug}/documents/${archivedDocumentId}`,
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
    `/api/organizations/${organizationSlug}/knowledge/nodes`,
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
    `/api/organizations/${organizationSlug}/knowledge/nodes`,
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
    `/api/organizations/${organizationSlug}/knowledge/edges`,
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
        `/api/organizations/${organizationSlug}/knowledge/edges/${edge.id}`
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
        `/api/organizations/${organizationSlug}/knowledge/nodes/${secondNode.id}`
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
    `/api/organizations/${organizationSlug}/knowledge/nodes`,
    {
      scope: { kind: "user" },
      kind: "concept",
      canonicalName: "Duplicate Entity",
      source: { memoryId: memory.id }
    }
  );
  await postJson(
    page,
    `/api/organizations/${organizationSlug}/knowledge/nodes`,
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
