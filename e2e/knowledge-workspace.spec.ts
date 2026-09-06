import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

async function jsonRequest<T>(page: Page, url: string, method = "GET", body?: Record<string, unknown>): Promise<T> {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(`Request failed: ${method} ${url} (${response.status})`);
    return value;
  }, { url, method, body }) as Promise<T>;
}

async function signup(page: Page, email: string, name: string) {
  await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/");
  await page.getByText("가입", { exact: true }).click();
  await page.getByLabel("이름").fill(name);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("agent-memory-e2e-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page.getByRole("heading", { name: "참여할 조직을 선택하세요" })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("completes knowledge work with real evidence, scoped access and responsive views", async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable migrated PostgreSQL database");
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/_(e2e|test)$/.test(new URL(databaseUrl).pathname.slice(1))) {
    throw new Error("Synthetic knowledge fixtures require an explicit DATABASE_URL ending in _e2e or _test");
  }
  const runId = process.env.E2E_RUN_ID;
  if (!runId) throw new Error("E2E_RUN_ID is required");
  const suffix = `${runId}-${testInfo.retry}`;
  const slug = `e2e-ux-${suffix}`;
  const organizationName = `Knowledge UX ${suffix}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /hydration|cannot be a descendant/i.test(message.text())) errors.push(message.text()); });
  // Better Auth uses single-value x-forwarded-for for its per-client rate limit.
  // Synthetic clients stay isolated without changing production auth policy.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.31" });
  await signup(page, `e2e-ux+${suffix}@nalbam.com`, "Knowledge Operator");
  const organization = await jsonRequest<{ id: string }>(page, "/api/organizations", "POST", { name: organizationName, slug });
  await page.goto("/memories");
  await page.getByRole("button", { name: "새 Memory", exact: true }).first().click();
  const create = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "새 Memory", exact: true }) });
  await expect(create).toHaveAccessibleName("새 Memory");
  await create.getByRole("textbox", { name: "제목", exact: true }).fill("UI rollback policy");
  await create.getByRole("textbox", { name: "내용", exact: true }).fill("Production rollback requires two reviewers.");
  await create.getByRole("button", { name: "새 Memory", exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "UI rollback policy", exact: true })).toBeVisible();
  const memoryId = new URL(page.url()).searchParams.get("memory");
  expect(memoryId).toBeTruthy();
  await page.getByRole("tab", { name: "수정", exact: true }).click();
  await page.getByLabel("내용", { exact: true }).fill("Production rollback requires three reviewers.");
  await page.getByLabel("변경 사유").fill("Add a release owner review");
  await page.getByRole("button", { name: "Revision 저장" }).click();
  await expect(page.getByText("새 revision을 저장했습니다.")).toBeVisible();
  await page.getByRole("tab", { name: "Version 이력" }).click();
  await expect(page.getByText("v2 · 현재")).toBeVisible();
  await expect(page.getByText("“Add a release owner review”", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "내용과 출처" }).click();
  await expect(page.getByText("Production rollback requires three reviewers.", { exact: true }).last()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "UI rollback policy", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("after-memory-desktop-ko.png"), fullPage: true });

  const shared = await jsonRequest<{ id: string }>(page, `/api/organizations/${slug}/memories`, "POST", { kind: "decision", scope: { kind: "organization" }, title: "Shared release standard", content: "Every release has an accountable owner.", source: { type: "user" } });
  const delayedMemory = await jsonRequest<{ id: string }>(page, `/api/organizations/${slug}/memories`, "POST", { kind: "fact", scope: { kind: "user" }, title: "Delayed archive fixture", content: "Synthetic disposable memory", source: { type: "user" } });
  const archiveStarted = Promise.withResolvers<void>();
  const releaseArchive = Promise.withResolvers<void>();
  const archiveDelivered = Promise.withResolvers<void>();
  const delayedPath = `**/api/organizations/${slug}/memories/${delayedMemory.id}`;
  await page.route(delayedPath, async (route) => {
    if (route.request().method() !== "DELETE") { await route.continue(); return; }
    const response = await route.fetch();
    archiveStarted.resolve();
    await releaseArchive.promise;
    await route.fulfill({ response });
    archiveDelivered.resolve();
  });
  await page.goto(`/memories?memory=${delayedMemory.id}`);
  await page.getByRole("tab", { name: "수정", exact: true }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archive 확인", exact: true }).click();
  await archiveStarted.promise;
  await page.getByRole("button", { name: /Shared release standard/ }).click();
  await expect(page.getByRole("heading", { name: "Shared release standard", exact: true })).toBeVisible();
  releaseArchive.resolve();
  await archiveDelivered.promise;
  await expect(page.getByRole("heading", { name: "Shared release standard", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`memory=${shared.id}`));
  await page.unroute(delayedPath);
  const me = await jsonRequest<{ user: { id: string } }>(page, `/api/organizations/${slug}/me`);
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  const readyId = randomUUID();
  const pendingId = randomUUID();
  const failedId = randomUUID();
  const chunkId = randomUUID();
  const rejectChunkId = randomUUID();
  const candidateId = randomUUID();
  const rejectCandidateId = randomUUID();
  // Only the worker output is seeded: all library, source, retry, review and graph
  // requests below use real authenticated HTTP routes and scoped repositories.
  try {
    for (const [id, title, status] of [[readyId, "Release source guide", "ready"], [pendingId, "Queued release notes", "pending"], [failedId, "Failed release notes", "failed"]]) {
      await database.query(`INSERT INTO documents (id, organization_id, scope_kind, title, object_key, checksum, mime_type, size_bytes, status, error_message, processing_attempts, source_uri, created_by) VALUES ($1,$2,'organization',$3,$4,$5,'text/markdown',120,$6,$7,1,$8,$9)`, [id, organization.id, title, `e2e/${id}`, id, status, status === "failed" ? "Synthetic parser failure: invalid section" : null, status === "ready" ? "https://example.com/release-guide" : "javascript:alert('invalid-source')", me.user.id]);
    }
    for (const [id, ordinal] of [[chunkId, 0], [rejectChunkId, 1]]) {
      await database.query("INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content) VALUES ($1,$2,$3,$4,$5)", [id, organization.id, readyId, ordinal, "Evidence API stores release records in Evidence Database. The source requires an accountable release owner."]);
    }
    const graph = { entities: [{ key: "api", kind: "service", canonicalName: "Evidence API" }, { key: "db", kind: "database", canonicalName: "Evidence Database" }], relationships: [{ sourceKey: "api", predicate: "stores_in", targetKey: "db" }] };
    for (const [id, sourceChunk] of [[candidateId, chunkId], [rejectCandidateId, rejectChunkId]]) {
      await database.query("INSERT INTO knowledge_candidates (id, organization_id, document_id, chunk_id, model, graph) VALUES ($1,$2,$3,$4,$5,$6)", [id, organization.id, readyId, sourceChunk, "synthetic-e2e-extractor", JSON.stringify(graph)]);
    }

    await page.goto(`/documents?document=${pendingId}`);
    await expect(page.getByRole("heading", { name: "Queued release notes", exact: true })).toBeVisible();
    await expect(page.getByText("처리 대기", { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("link", { name: "javascript:alert('invalid-source')", exact: true })).toHaveCount(0);
    await database.query("UPDATE documents SET status='processing', processing_attempts=2, updated_at=now() WHERE id=$1", [pendingId]);
    await expect(page.getByText("처리 중", { exact: true }).last()).toBeVisible();
    await database.query("UPDATE documents SET status='ready', updated_at=now() WHERE id=$1", [pendingId]);
    await expect(page.getByRole("button", { name: /Queued release notes.*사용 가능/ })).toBeVisible();
    await page.getByRole("button", { name: /Failed release notes/ }).click();
    await expect(page.getByText("Synthetic parser failure: invalid section", { exact: true })).toBeVisible();
    const retryResponse = page.waitForResponse((response) => response.url().endsWith(`/documents/${failedId}/retry`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "처리 재시도", exact: true }).click();
    expect((await retryResponse).status()).toBe(202);
    await expect(page.getByText("재처리를 요청했습니다. 작업이 시작되면 상태가 갱신됩니다.")).toBeVisible();
    await database.query("UPDATE documents SET status='processing', processing_attempts=2, error_message=NULL, updated_at=now() WHERE id=$1", [failedId]);
    await expect(page.getByText("처리 중", { exact: true }).last()).toBeVisible();
    await database.query("UPDATE documents SET status='ready', updated_at=now() WHERE id=$1", [failedId]);
    await expect(page.getByRole("button", { name: /Failed release notes.*사용 가능/ })).toBeVisible();
    await page.getByRole("button", { name: /Release source guide/ }).click();
    await expect(page.getByRole("link", { name: "https://example.com/release-guide", exact: true })).toHaveAttribute("rel", "noopener noreferrer");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-documents-desktop-ko.png"), fullPage: true });

    await page.goto("/review");
    await expect(page.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toBeVisible();
    await expect(page.getByText("stores_in", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-review-desktop-ko.png"), fullPage: true });
    const acceptResponse = page.waitForResponse((response) => response.url().includes("/knowledge/candidates/") && response.url().endsWith("/accept"));
    await page.getByRole("button", { name: "Graph에 승인", exact: true }).click();
    expect((await acceptResponse).status()).toBe(200);
    await expect(page.getByText("검토 대기 · 1", { exact: true })).toBeVisible();
    await page.getByLabel("검토 사유", { exact: true }).fill("Duplicate evidence is unnecessary for this example");
    const rejectResponse = page.waitForResponse((response) => response.url().includes("/knowledge/candidates/") && response.url().endsWith("/reject"));
    await page.getByRole("button", { name: "거절", exact: true }).click();
    expect((await rejectResponse).status()).toBe(200);

    await jsonRequest(page, `/api/organizations/${slug}/knowledge/nodes`, "POST", { scope: { kind: "organization" }, kind: "service", canonicalName: "Evidence API", source: { memoryId: shared.id } });
    await page.goto("/?q=Evidence%20API&kind=knowledge%2Fnodes");
    await page.getByRole("button", { name: /Evidence API/ }).click();
    await expect(page.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "관계 보기", exact: true }).click();
    await page.getByRole("button", { name: "DATABASE Evidence Database", exact: true }).click();
    await expect(page.getByText("← stores_in", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "원문 근거 · 1", exact: true }).last().click();
    await expect(page.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "SERVICE Evidence API", exact: true }).click();
    await page.getByRole("button", { name: "원문 근거 · 2", exact: true }).click();
    await expect(page.getByText("Every release has an accountable owner.", { exact: true })).toBeVisible();
    await expect(page.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-graph-desktop-ko.png"), fullPage: true });

    const memberContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.32" } });
    try {
      const member = await memberContext.newPage();
      await signup(member, `e2e-ux-member+${suffix}@nalbam.com`, "Knowledge Reader");
      await jsonRequest(member, `/api/organizations/${slug}/join`, "POST");
      const session = await jsonRequest<{ user: { id: string } }>(member, "/api/auth/get-session");
      await jsonRequest(page, `/api/organizations/${slug}/members/${session.user.id}`, "PATCH", { status: "active" });
      await member.goto(`/memories?memory=${shared.id}`);
      await expect(member.getByRole("heading", { name: "Shared release standard", exact: true })).toBeVisible();
      await expect(member.getByRole("tab", { name: "수정", exact: true })).toHaveCount(0);
      await expect(member.getByRole("tab", { name: "Version 이력", exact: true })).toHaveCount(0);
      await member.getByRole("button", { name: "새 Memory", exact: true }).first().click();
      await member.getByRole("dialog").filter({ has: member.getByRole("heading", { name: "새 Memory", exact: true }) }).getByRole("combobox", { name: "공유 범위" }).click();
      await expect(member.getByRole("option", { name: "조직 · 모든 조직 멤버와 공유" })).toHaveCount(0);
      await member.keyboard.press("Escape");
      await member.keyboard.press("Escape");
      const blockedWrite = await member.evaluate(async (slug) => (await fetch(`/api/organizations/${slug}/memories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "fact", title: "Disallowed organization write", content: "Must not persist", scope: { kind: "organization" }, source: { type: "user" } }) })).status, slug);
      expect(blockedWrite).toBe(403);
      await member.goto(`/memories?memory=${memoryId}`);
      await expect(member.getByRole("heading", { name: "UI rollback policy", exact: true })).toHaveCount(0);
      await expect(member.getByRole("alert")).toBeVisible();
      await member.goto(`/documents?document=${readyId}`);
      await expect(member.getByRole("heading", { name: "Release source guide", exact: true })).toBeVisible();
      await expect(member.getByRole("button", { name: "문서 보관", exact: true })).toHaveCount(0);
      await member.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await member.screenshot({ path: testInfo.outputPath("after-reader-access-ko.png"), fullPage: true });
    } finally { await memberContext.close(); }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/memories?memory=${memoryId}`);
    await expect(page.getByRole("heading", { name: "UI rollback policy", exact: true })).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "목록으로", exact: true }).click();
    await page.getByRole("button", { name: /UI rollback policy/ }).click();
    await expect(page.getByRole("heading", { name: "UI rollback policy", exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-memory-mobile-ko.png"), fullPage: true });
    await page.goto(`/documents?document=${readyId}`);
    await expect(page.getByRole("heading", { name: "Release source guide", exact: true })).toBeVisible();
    await noOverflow(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-documents-mobile-ko.png"), fullPage: true });
    await page.context().addCookies([{ name: "agent-memory-locale", value: "en", domain: "127.0.0.1", path: "/" }]);
    await page.evaluate(() => localStorage.setItem("mantine-color-scheme-value", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
    await expect(page.getByRole("heading", { name: "Document library", exact: true })).toBeVisible();
    await noOverflow(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-documents-mobile-en-dark.png"), fullPage: true });
    await page.goto("/?q=Evidence%20API&kind=knowledge%2Fnodes");
    await page.getByRole("button", { name: /Evidence API/ }).click();
    await page.getByRole("button", { name: "View relationships", exact: true }).click();
    await expect(page.getByRole("button", { name: "DATABASE Evidence Database", exact: true })).toBeVisible();
    await noOverflow(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-graph-mobile-en-dark.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
    const other = await jsonRequest<{ id: string }>(page, "/api/organizations", "POST", { name: `UX isolated ${suffix}`, slug: `e2e-ux-other-${suffix}` });
    expect(other.id).not.toBe(organization.id);
    await page.goto(`/documents?document=${readyId}`);
    await expect(page.getByRole("heading", { name: "Release source guide", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "활성 조직" }).click();
    await page.getByRole("option", { name: `UX isolated ${suffix}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Release source guide", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "첫 원문 문서를 추가하세요", exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/document=/);
    expect(errors).toEqual([]);
  } finally { await database.end(); }
});
