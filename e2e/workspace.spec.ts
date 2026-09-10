import { expect, test, type Page } from "@playwright/test";

import { resetInstallationFixture } from "./installation-fixture";

const authenticatedE2e = process.env.E2E_AUTHENTICATED === "true";

test("explains the product workflow in the public guide", async ({ page }, testInfo) => {
  await page.goto("/guide");

  await expect(
    page.getByRole("heading", {
      name: "More than storing memory, make it trustworthy and reusable."
    })
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Guide contents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with a membership request and approval." })).toBeVisible();
  await expect(page.getByText("Operator approval", { exact: true })).toBeVisible();
  await expect(page.getByText("/api/mcp", { exact: true })).toBeVisible();
  await page.locator("#start").screenshot({ path: testInfo.outputPath("guide-start-desktop-en.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("#start").screenshot({ path: testInfo.outputPath("guide-start-mobile-en.png") });
  await expect(
    page.getByRole("heading", { name: "Follow relationships without losing the evidence." })
  ).toBeVisible();
  await expect(page.getByText("recall", { exact: true })).toBeVisible();
  await expect(page.getByText("remember", { exact: true })).toBeVisible();
  await expect(page.getByText("forget", { exact: true })).toBeVisible();
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
  test.skip(!authenticatedE2e, "requires a disposable initialized PostgreSQL database");
  test.setTimeout(90_000);
  await resetInstallationFixture();
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID must be configured by Playwright");
  }
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.11" });
  const adminEmail = `e2e-admin2+${runId}-${testInfo.retry}@nalbam.com`;
  const memberEmail = `e2e-member+${runId}-${testInfo.retry}@nalbam.com`;
  const password = "agent-memory-e2e-password";

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
    page.getByRole("heading", { name: "통합 검색", exact: true })
  ).toBeVisible();

  const authCookieNames = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(authCookieNames).toContain("agent-memory.session_token");
  expect(authCookieNames).not.toContain("better-auth.session_token");
  expect(authCookieNames).not.toContain("agent-studio.session_token");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "설정", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "문서 처리", exact: true }).click();
  const enrichment = page.getByRole("textbox", { name: /KNOWLEDGE_ENRICHMENT_CONCURRENCY/ });
  await expect(enrichment).toHaveValue("4");
  await enrichment.fill("6");
  await expect(page.getByRole("button", { name: "설치 설정 저장", exact: true })).toBeEnabled();
  await enrichment.fill("4");
  await expect(page.getByRole("button", { name: "설치 설정 저장", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "AI 모델", exact: true }).click();
  await page.getByRole("textbox", { name: "설치 설정 검색 · 이름 또는 환경 변수" }).fill("KNOWLEDGE_ENRICHMENT_CONCURRENCY");
  await expect(enrichment).toBeVisible();
  await page.getByRole("button", { name: "검색 지우기", exact: true }).click();
  await expect(page.getByLabel(/EMBEDDING_API_KEY/)).toHaveValue("");
  await page.getByLabel(/EMBEDDING_API_KEY/).fill("draft-secret-only");
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(page.getByLabel(/EMBEDDING_API_KEY/)).toHaveValue("");
  await expect(page.getByRole("button", { name: "설치 설정 저장", exact: true })).toBeDisabled();

  const extractionLanguage = page.getByRole("combobox", { name: /KNOWLEDGE_EXTRACTION_LANGUAGE/ });
  await expect(extractionLanguage).toHaveValue("한국어");
  await extractionLanguage.click();
  await page.getByRole("option", { name: "영어", exact: true }).click();
  await page.getByRole("button", { name: "설치 설정 저장", exact: true }).click();
  await expect(page.getByText("애플리케이션 설정을 저장했습니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("재시작 후 적용되는 변경이 있습니다.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(extractionLanguage).toHaveValue("영어");
  await page.getByRole("button", { name: "KNOWLEDGE_EXTRACTION_LANGUAGE에 환경 변수 값 사용", exact: true }).click();
  await page.getByRole("button", { name: "설치 설정 저장", exact: true }).click();
  await expect(extractionLanguage).toHaveValue("한국어");

  await page.screenshot({ path: testInfo.outputPath("settings-ai-desktop-ko.png"), fullPage: true });
  await page.getByRole("button", { name: "인증 및 접근", exact: true }).click();
  await expect(page.getByLabel(/ALLOWED_EMAIL_DOMAINS/)).toHaveValue("nalbam.com");
  await page.getByRole("button", { name: "로그 및 모니터링", exact: true }).click();
  const logLevel = page.getByRole("combobox", { name: /LOG_LEVEL/ });
  const exportMode = page.getByRole("combobox", { name: /LANGFUSE_EXPORT_MODE/ });
  await exportMode.click(); await page.getByRole("option", { name: "batched", exact: true }).click();
  await page.getByRole("button", { name: "자동 · 실행 환경 기본값", exact: true }).click({ timeout: 15_000 });
  await expect(exportMode).toHaveValue("");
  await expect(page.getByRole("button", { name: "설치 설정 저장", exact: true })).toBeDisabled();

  await logLevel.click(); await page.getByRole("option", { name: "trace", exact: true }).click();
  await logLevel.click(); await page.getByRole("option", { name: "debug", exact: true }).click();
  await page.getByRole("button", { name: "AI 모델", exact: true }).click();
  await page.getByRole("button", { name: "로그 및 모니터링", exact: true }).click();
  await expect(logLevel).toHaveValue("debug");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "가이드", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?section=observability$/);
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: "로그 및 모니터링", exact: true }).click();
  await expect(logLevel).toHaveValue("debug");


  await page.route("**/api/settings/runtime", async (route) => {
    if (route.request().method() === "PUT") { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Settings temporarily unavailable" }) }); }
    else { await route.continue(); }
  });
  await page.getByRole("button", { name: "설치 설정 저장", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Settings temporarily unavailable" })).toBeVisible();
  await expect(logLevel).toHaveValue("debug");
  await page.unroute("**/api/settings/runtime");
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/settings/runtime", async (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toEqual({ reset: [], values: { LOG_LEVEL: "debug" } });
      await saveGate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "설치 설정 저장", exact: true }).click();
  await expect(logLevel).toBeDisabled();
  releaseSave();
  await expect(page.getByText("애플리케이션 설정을 저장했습니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("재시작 후 적용되는 변경이 있습니다.", { exact: true })).toBeVisible();
  await page.unroute("**/api/settings/runtime");
  await page.reload();
  await expect(logLevel).toHaveValue("debug");
  const restoreLogLevel = page.getByRole("button", { name: "LOG_LEVEL에 환경 변수 값 사용", exact: true });
  await restoreLogLevel.click();
  await expect(logLevel).toBeDisabled();
  await restoreLogLevel.click();
  await expect(logLevel).toBeEnabled();
  await restoreLogLevel.click();
  await page.getByRole("button", { name: "설치 설정 저장", exact: true }).click();
  await expect(page.getByText("애플리케이션 설정을 저장했습니다.", { exact: true })).toBeVisible();
  await expect(restoreLogLevel).toHaveCount(0);
  await expect(logLevel).toHaveValue("info");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(logLevel).toHaveValue("info");
  const settingsNavigation = page.getByRole("navigation", { name: "설정 분류", exact: true });
  await expect.poll(async () => (await settingsNavigation.boundingBox())?.x ?? 1000).toBeLessThan(25);
  await expect.poll(async () => (await settingsNavigation.boundingBox())?.width ?? 0).toBeGreaterThan(340);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-mobile-ko.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });

  const defaultTeam = await postJson<{ id: string }>(
    page,
    `/api/teams`,
    { name: "E2E Default Team", slug: `e2e-default-${runId}-${testInfo.retry}` }
  );

  let releaseRecommendations!: () => void;
  const recommendationsGate = new Promise<void>((resolve) => { releaseRecommendations = resolve; });
  await page.route("**/api/knowledge/ontology/recommendations", async (route) => {
    await recommendationsGate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "recommendations unavailable" }) });
  });
  await page.goto("/settings?section=general");
  await expect(page.getByRole("heading", { name: "조직 프로필", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "검증 모드", exact: true })).toBeHidden();
  await expect(page.getByRole("combobox", { name: "신규 회원 정책" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "기본 팀" }).click();
  await page.getByRole("option", { name: "E2E Default Team" }).click();
  releaseRecommendations();
  await page.getByRole("button", { name: "지식 사전", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "기본 팀", exact: true })).toBeHidden();
  await expect(page.getByText("추천 용어를 불러오지 못했습니다. 직접 편집과 저장은 계속할 수 있습니다.", { exact: true })).toBeVisible();
  await page.unroute("**/api/knowledge/ontology/recommendations");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByText("추천 용어를 불러오지 못했습니다. 직접 편집과 저장은 계속할 수 있습니다.", { exact: true })).toHaveCount(0);

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
  await page.screenshot({ path: testInfo.outputPath("settings-dictionary-desktop-ko.png"), fullPage: true });
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

  const memberContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.12" } });
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
    memberPage.getByRole("heading", { name: "접근 승인 대기" })
  ).toBeVisible();
  await expect(
    memberPage.getByText("조직 관리자의 승인을 기다리고 있습니다.")
  ).toBeVisible();
  expect((await memberPage.request.get("/api/memories")).status()).toBe(403);
  await memberPage.reload();
  await expect(memberPage.getByText("조직 관리자의 승인을 기다리고 있습니다.")).toBeVisible();

  await page.goto("/members");
  await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: memberEmail }).getByText("승인 대기", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "승인" }).click();
  await expect(page.getByText("회원을 승인했습니다.")).toBeVisible();
  await expect(page.getByText("E2E Default Team").first()).toBeVisible();
  await page.goto("/teams");
  const teamSelector = page.getByRole("button", {
    name: "E2E Default Team",
    exact: true
  });
  await expect(teamSelector).toHaveAttribute("aria-pressed", "true");
  await teamSelector.focus();
  await page.keyboard.press("Space");
  const otherTeam = await postJson<{ id: string }>(
    page,
    `/api/teams`,
    { name: "E2E Other Team", slug: `e2e-other-team-${runId}-${testInfo.retry}` }
  );
  const delayedMembers = Promise.withResolvers<void>();
  const membersRequested = Promise.withResolvers<void>();
  const defaultMembersPath = `**/api/teams/${defaultTeam.id}/members`;
  const otherMembersPath = `**/api/teams/${otherTeam.id}/members`;
  await page.route(defaultMembersPath, async (route) => {
    const response = await route.fetch();
    membersRequested.resolve();
    await delayedMembers.promise;
    await route.fulfill({ response });
  });
  await page.route(otherMembersPath, (route) => route.fulfill({
    json: {
      members: [{
        teamId: otherTeam.id,
        userId: "10000000-0000-4000-8000-000000000099",
        name: "Other Team Member",
        email: "other-team-member@nalbam.com",
        role: "member"
      }]
    }
  }));
  await page.reload();
  await membersRequested.promise;
  await page.getByRole("button", { name: "E2E Other Team", exact: true }).click();
  await expect(page.getByText("other-team-member@nalbam.com", { exact: true })).toBeVisible();
  delayedMembers.resolve();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("other-team-member@nalbam.com", { exact: true })).toBeVisible();
  await page.unroute(defaultMembersPath);
  await page.unroute(otherMembersPath);
  const delayedTeams = Promise.withResolvers<void>();
  const teamsRequested = Promise.withResolvers<void>();
  const teamsPath = `**/api/teams`;
  let delayNextTeamList = true;
  await page.route(teamsPath, async (route) => {
    if (route.request().method() !== "GET" || !delayNextTeamList) {
      await route.continue();
      return;
    }
    delayNextTeamList = false;
    const response = await route.fetch();
    teamsRequested.resolve();
    await delayedTeams.promise;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "새로고침" }).click();
  await teamsRequested.promise;
  const latestTeamName = `E2E Latest Team ${testInfo.retry}`;
  await page.getByRole("textbox", { name: "팀 이름", exact: true }).fill(
    latestTeamName
  );
  await page.getByLabel("팀 slug").fill(`e2e-latest-${runId}-${testInfo.retry}`);
  await page.getByRole("button", { name: "팀 만들기" }).click();
  await expect(page.getByText("팀을 만들었습니다.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: latestTeamName, exact: true })
  ).toBeVisible();
  delayedTeams.resolve();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("button", { name: latestTeamName, exact: true })
  ).toBeVisible();
  await page.unroute(teamsPath);
  await page.goto("/members");
  await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();

  await memberPage.goto("/");
  await expect(
    memberPage.getByRole("heading", { name: "통합 검색", exact: true })
  ).toBeVisible();

  await expect(memberPage.getByRole("combobox", { name: "활성 조직" })).toHaveCount(0);

  await page.getByRole("button", { name: `${memberEmail}에 대한 작업` }).click();
  await page.getByRole("menuitem", { name: "차단" }).click();
  await expect(page.getByText("회원을 차단했습니다.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: memberEmail }).getByText("차단됨", { exact: true })).toBeVisible();
  await memberPage.goto("/");
  await expect(memberPage.getByRole("heading", { name: "접근이 제한되었습니다" })).toBeVisible();
  await expect(memberPage.getByText("가입이 요청으로 접수되었습니다.", { exact: false })).toHaveCount(0);

  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ error: "sign out unavailable" }),
      status: 503
    })
  );
  await page.getByRole("button", { name: "계정 메뉴" }).click();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();
  await expect(page.getByText("로그아웃에 실패했습니다.")).toBeVisible();

  await memberContext.close();
});

test("manages memory lifecycle and explores grounded knowledge", async ({
  page
}, testInfo) => {
  test.skip(!authenticatedE2e, "requires a disposable initialized PostgreSQL database");
  test.setTimeout(90_000);
  await resetInstallationFixture();
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error("E2E_RUN_ID must be configured by Playwright");
  }
  const renderingErrors: string[] = [];
  page.on("console", (message) => {
    if ((message.type() === "error" || message.type() === "warning") && /hydration|cannot be a descendant|same key|unique.*key/i.test(message.text())) renderingErrors.push(message.text());
  });
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.21" });
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
    page.getByRole("heading", { name: "통합 검색", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "첫 조직 만들기" })).toHaveCount(0);
  const organizationSlug = "default";
  const response = await page.request.get("/api/organization");
  expect(response.ok()).toBe(true);
  const organization = await response.json() as { id: string };
  expect((await page.request.post("/api/organization", { data: { name: "Forbidden", slug: "other" } })).status()).toBe(405);
  expect((await page.request.delete("/api/organization")).status()).toBe(405);
  const team = await postJson<{ id: string }>(
    page,
    `/api/teams`,
    { name: "E2E Team", slug: `e2e-team-${runId}-${testInfo.retry}` }
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "통합 검색", exact: true })
  ).toBeVisible();
  const organizationId = organization.id;

  await page.getByRole("textbox", { name: "검색", exact: true }).fill("Unsubmitted document query");
  await page.getByRole("radiogroup").getByText("Documents", { exact: true }).click();
  await expect(page).toHaveURL(/kind=documents/);
  await expect(page.getByRole("textbox", { name: "검색", exact: true })).toHaveValue("Unsubmitted document query");
  await expect(page).toHaveURL(/q=Unsubmitted\+document\+query/);
  await page.getByRole("textbox", { name: "검색", exact: true }).fill("");
  await page.getByRole("radiogroup").getByText("Memory", { exact: true }).click();
  await expect(page).toHaveURL(/kind=memories/);
  await expect(page.getByRole("textbox", { name: "검색", exact: true })).toHaveValue("");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);

  await page.getByRole("link", { name: "문서 수집" }).click();
  await page.getByRole("button", { name: "문서 수집", exact: true }).first().click();
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
    `**/api/documents`,
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
  await expect(page.getByText("문서를 업로드했습니다. 상세 화면에서 처리 상태를 확인하세요.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "활성 조직" })).toHaveCount(0);

  await page.getByRole("link", { name: "Agent 연결" }).click();
  const mcpEndpoint = `${new URL(page.url()).origin}/api/mcp`;
  const registrationTemplate = page.getByRole("region", {
    name: "Agent Studio 등록 템플릿"
  });
  await expect(registrationTemplate.getByText(mcpEndpoint, { exact: true })).toBeVisible();
  await expect(registrationTemplate.getByText(`${organizationSlug}-memory`, { exact: true })).toBeVisible();
  await registrationTemplate.getByRole("button", { name: "등록 템플릿 URL 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(mcpEndpoint);
  await registrationTemplate.getByRole("button", { name: "등록 템플릿 Description 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${organizationSlug} 조직에 저장된 결정·규칙·경험, 문서 근거, 지식 간 관계를 확인할 때 사용합니다. Memory·RAG·Knowledge Graph를 검색하고 공유할 정보를 조직 범위 Memory로 저장합니다.`
  );
  await expect(registrationTemplate).toContainText("Content는 운영자에게만 표시됩니다.");
  await registrationTemplate.getByRole("button", { name: "등록 템플릿 Content 복사" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
    "이 Content는 모델에 전달되지 않는 운영자 메모다."
  );
  const accessRequested = Promise.withResolvers<void>();
  const releaseAccess = Promise.withResolvers<void>();
  const accessPath = `**/api/me`;
  await page.route(accessPath, async (route) => {
    const response = await route.fetch();
    accessRequested.resolve();
    await releaseAccess.promise;
    await route.fulfill({ response });
  });
  await page.reload();
  await accessRequested.promise;
  await expect(registrationTemplate.getByText(mcpEndpoint, { exact: true })).toBeVisible();
  const endpointCopy = page.getByRole("button", { name: "MCP endpoint 복사" });
  const endpointElement = await endpointCopy.elementHandle();
  await endpointCopy.click();
  await expect(endpointCopy).toHaveText("복사됨");
  releaseAccess.resolve();
  await expect(page.getByRole("button", { name: "Token 생성", exact: true })).toBeVisible();
  // Permission resolution must not remount the endpoint and reset copy feedback.
  expect(await endpointElement?.evaluate((element) => element.isConnected)).toBe(true);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(mcpEndpoint);
  await page.unroute(accessPath);
  await page.getByRole("button", { name: "Token 생성" }).click();
  const authorization = await page
    .getByText(/^Bearer amt_[A-Za-z0-9_-]{43}$/)
    .textContent();
  expect(authorization).toBeTruthy();
  await expect(registrationTemplate.getByText("Bearer <amt_token>", { exact: true })).toBeVisible();
  await expect(registrationTemplate).not.toContainText(authorization!);
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

  await page.context().addCookies([
    { name: "agent-memory-locale", value: "en", domain: "127.0.0.1", path: "/" }
  ]);
  await page.reload();
  const englishTemplate = page.getByRole("region", {
    name: "Agent Studio registration template"
  });
  await expect(englishTemplate).toContainText(`knowledge relationships stored in the ${organizationSlug} organization`);
  await expect(englishTemplate).toContainText("optional Content is shown only to operators.");
  await englishTemplate.getByRole("button", { name: "Copy template Name", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${organizationSlug}-memory`);
  await page.context().addCookies([
    { name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }
  ]);
  await page.reload();

  const candidateId = "80000000-0000-4000-8000-000000000099";
  let duplicateRequests = 0;
  await page.route(
    `**/api/knowledge/candidates?limit=100`,
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
                relationships: [
                  {
                    sourceKey: "api",
                    predicate: "stores_data_in",
                    targetKey: "db"
                  }
                ]
              },
              createdAt: "2026-08-27T00:00:00.000Z"
            }
          ]
        }),
        status: 200
      })
  );
  await page.route(
    `**/api/knowledge/candidates/${candidateId}/duplicates`,
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
            violations: [
              { type: "unknown_kind", term: "database" },
              { type: "unknown_predicate", term: "stores_data_in" }
            ]
          }
        }),
        status: 200
      });
    }
  );
  await page.getByRole("link", { name: "AI 후보 검토" }).click();
  await page.getByRole("tab", { name: "청크별 검토", exact: true }).click();
  await expect(
    page.getByText(/같은 scope와 이름의 기존 node가 1개 있습니다/)
  ).toBeVisible();
  await expect(page.getByText("온톨로지에 없음", { exact: true })).toHaveCount(2);
  await expect(
    page.getByText(/온톨로지 사전에 없는 용어가 포함되어 있습니다: database/)
  ).toBeVisible();
  await expect(page.getByText("stores_data_in", { exact: true })).toBeVisible();
  expect(renderingErrors).toEqual([]);
  expect(duplicateRequests).toBe(1);

  await page.getByRole("link", { name: "통합 검색" }).click();

  const memory = await postJson<{ id: string }>(
    page,
    `/api/memories`,
    {
      kind: "decision",
      scope: { kind: "user" },
      title: "Checkout rollback policy",
      content: "Checkout rollback requires two approvers.",
      source: { type: "user" }
    }
  );

  await page.getByRole("radiogroup").getByText("Memory", { exact: true }).click();
  await expect(page).toHaveURL(/kind=memories/);
  await expect(page.getByRole("radio", { name: "Memory", exact: true })).toBeChecked();
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("checkout rollback");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Checkout rollback policy")).toBeVisible();
  await page.getByRole("button", { name: /Checkout rollback policy/ }).click();

  const lifecycle = page.getByRole("region", { name: "지식 상세" });
  await lifecycle.getByRole("tab", { name: "수정", exact: true }).click();
  await expect(lifecycle.getByText("Version 이력")).toBeVisible();
  await lifecycle
    .getByRole("textbox", { name: "내용", exact: true })
    .fill("Checkout rollback requires three approvers.");
  await lifecycle.getByLabel("변경 사유").fill("E2E revision verification");
  await lifecycle.getByRole("button", { name: "Revision 저장" }).click();
  await expect(lifecycle.getByText("새 revision을 저장했습니다.")).toBeVisible();
  await lifecycle.getByRole("tab", { name: "Version 이력" }).click();
  await expect(lifecycle.getByText("v2 · 현재")).toBeVisible();
  await lifecycle.getByRole("tab", { name: "내용과 출처" }).click();
  await lifecycle.getByRole("button", { name: "목록으로 돌아가기" }).click();
  await expect(page.getByText("Checkout rollback requires three approvers.", { exact: true }))
    .toBeVisible();

  const archivedDocumentId = "40000000-0000-0000-0000-000000000099";
  await page.route(
    `**/api/documents?q=*`,
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
    `**/api/documents/${archivedDocumentId}`,
    async (route) => {
      if (route.request().method() === "DELETE") await route.fulfill({ status: 204 });
      else await route.fulfill({ json: { id: archivedDocumentId, title: "Archived team guide", mimeType: "text/markdown", scope: { kind: "organization", organizationId }, sizeBytes: 10, status: "ready", processingAttempts: 1, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" } });
    }
  );
  await page.getByRole("radiogroup").getByText("Documents", { exact: true }).click();
  await expect(page).toHaveURL(/kind=documents/);
  await expect(page.getByRole("radio", { name: "Documents", exact: true })).toBeChecked();
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("team guide");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Archived team guide")).toBeVisible();
  await page.getByRole("button", { name: /Archived team guide/ }).click();
  await page.getByRole("link", { name: "문서 상세 열기" }).click();
  await page.getByRole("button", { name: "문서 보관" }).click();
  const archiveDialog = page.getByRole("dialog", { name: "문서 보관" });
  await archiveDialog.getByRole("button", { name: "문서 보관" }).click();
  await expect(page.getByText("문서를 보관했습니다.")).toBeVisible();
  await expect(page.getByText("Archived team guide", { exact: true })).not.toBeVisible();

  await page.goto("/");
  const firstNode = await postJson<{ id: string }>(
    page,
    `/api/knowledge/nodes`,
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
    `/api/knowledge/nodes`,
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
    `/api/knowledge/edges`,
    {
      scope: { kind: "user" },
      sourceNodeId: firstNode.id,
      targetNodeId: secondNode.id,
      predicate: "depends_on",
      source: { memoryId: memory.id }
    }
  );

  const graphSearch = await page.request.get("/api/knowledge/nodes?q=Checkout%20API");
  expect(graphSearch.ok()).toBe(true);
  expect(await graphSearch.json()).toMatchObject({ hits: [expect.objectContaining({ node: expect.objectContaining({ id: firstNode.id }) })] });
  await page.getByRole("radiogroup").getByText("Graph", { exact: true }).click();
  await expect(page).toHaveURL(/kind=knowledge%2Fnodes/);
  await expect(page.getByRole("radio", { name: "Graph", exact: true })).toBeChecked();
  await page
    .getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요")
    .fill("Checkout API");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("Checkout API", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Checkout API/ }).click();
  await page.getByRole("button", { name: "관계 보기" }).first().click();
  await expect(page.getByRole("button", { name: "검색 결과로 돌아가기" })).toBeVisible();
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
        `/api/knowledge/edges/${edge.id}`
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
        `/api/knowledge/nodes/${secondNode.id}`
      ) && response.request().method() === "DELETE"
  );
  await page.getByRole("button", { name: "Node 삭제" }).click();
  await page.getByRole("dialog", { name: "Graph resource 삭제" })
    .getByRole("button", { name: "삭제 확인" })
    .click();
  await nodeDeleteResponse;
  await expect(page.getByText("Graph에서 Orders Database을 삭제했습니다.")).toBeVisible();

  await page.getByRole("button", { name: "검색 결과로 돌아가기" }).click();
  await postJson(
    page,
    `/api/knowledge/nodes`,
    {
      scope: { kind: "user" },
      kind: "concept",
      canonicalName: "Duplicate Entity",
      source: { memoryId: memory.id }
    }
  );
  await postJson(
    page,
    `/api/knowledge/nodes`,
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
  await page.getByRole("button", { name: /Duplicate Entity/ }).first().click();
  await page.getByRole("button", { name: "중복 병합" }).first().click();
  const mergeDialog = page.getByRole("dialog", { name: "중복 node 병합" });
  await mergeDialog.getByLabel("병합 사유").fill("E2E duplicate verification");
  await mergeDialog.getByRole("button", { name: "병합 확인" }).click();
  await expect(page.getByText("중복된 Duplicate Entity node를 병합했습니다.")).toBeVisible();
  await expect(page.locator("[aria-label=\"검색 결과 목록\"]").getByText("Duplicate Entity", { exact: true })).toHaveCount(1);
  await page.getByRole("radiogroup").getByText("Memory", { exact: true }).click();
  await expect(page).toHaveURL(/kind=memories/);
  await expect(page.getByRole("radio", { name: "Memory", exact: true })).toBeChecked();
  await page.getByPlaceholder("정책, 장애 대응, 시스템 관계를 검색하세요").fill("checkout rollback");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await page.getByRole("button", { name: /Checkout rollback policy/ }).click();
  await lifecycle.getByRole("tab", { name: "수정", exact: true }).click();
  await lifecycle.getByRole("button", { name: "Archive", exact: true }).click();
  const refreshedMemories = page.waitForResponse((response) =>
    response.url().includes(`/api/memories?q=`) &&
    response.request().method() === "GET"
  );
  await lifecycle.getByRole("button", { name: "Archive 확인", exact: true }).click();
  const refreshedResponse = await refreshedMemories;
  expect(refreshedResponse.ok()).toBe(true);
  expect(await refreshedResponse.json()).toMatchObject({ hits: [] });
  await expect(lifecycle.getByRole("tab", { name: "수정", exact: true })).not.toBeVisible();
  await expect(page.getByText("Checkout rollback policy", { exact: true })).not.toBeVisible();
  expect(renderingErrors).toEqual([]);
});
