import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { resetInstallationFixture } from "./installation-fixture";

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
  await expect(page.getByRole("heading", { name: name === "Knowledge Operator" ? "통합 검색" : "접근 승인 대기", exact: true })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("completes knowledge work with real evidence, scoped access and responsive views", async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable initialized PostgreSQL database");
  test.setTimeout(240_000);
  await resetInstallationFixture();
  page.setDefaultTimeout(15_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/_(e2e|test)$/.test(new URL(databaseUrl).pathname.slice(1))) {
    throw new Error("Synthetic knowledge fixtures require an explicit DATABASE_URL ending in _e2e or _test");
  }
  const runId = process.env.E2E_RUN_ID;
  if (!runId) throw new Error("E2E_RUN_ID is required");
  const suffix = `${runId}-${testInfo.retry}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if ((message.type() === "error" || message.type() === "warning") && /hydration|cannot be a descendant|same key|unique.*key/i.test(message.text())) errors.push(message.text()); });
  // Better Auth uses single-value x-forwarded-for for its per-client rate limit.
  // Synthetic clients stay isolated without changing production auth policy.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.31" });
  await signup(page, `e2e-ux+${suffix}@nalbam.com`, "Knowledge Operator");
  const organization = await jsonRequest<{ id: string }>(page, "/api/organization");
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

  const unavailableFixture = await jsonRequest<{ id: string }>(page, `/api/memories`, "POST", { kind: "fact", scope: { kind: "user" }, title: "Unavailable response fixture", content: "Original synthetic content", source: { type: "user" } });
  let refuseNextRead = false;
  const unavailablePath = `**/api/memories/${unavailableFixture.id}`;
  // The mutation is real; only its follow-up read simulates access being revoked.
  await page.route(unavailablePath, async (route) => {
    if (route.request().method() === "PATCH") {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      refuseNextRead = true;
      await route.fulfill({ response });
    } else if (route.request().method() === "GET" && refuseNextRead) {
      await route.fulfill({ status: 403, json: { error: "Synthetic access change" } });
    } else await route.continue();
  });
  await page.goto(`/memories?memory=${unavailableFixture.id}`);
  await page.getByRole("tab", { name: "수정", exact: true }).click();
  await page.getByRole("textbox", { name: "내용", exact: true }).fill("Saved synthetic content after access change");
  await page.getByRole("button", { name: "Revision 저장", exact: true }).click();
  const unavailableDetail = page.getByRole("region", { name: "내용과 출처", exact: true });
  await expect(unavailableDetail.getByText("이 Memory가 없거나 접근 권한이 변경되었습니다.", { exact: true })).toBeVisible();
  await expect(unavailableDetail.getByRole("tab", { name: "수정", exact: true })).toHaveCount(0);
  await expect(unavailableDetail.getByText("Original synthetic content", { exact: true })).toHaveCount(0);
  await expect(unavailableDetail.getByText("Saved synthetic content after access change", { exact: true })).toHaveCount(0);
  await page.unroute(unavailablePath);
  await unavailableDetail.getByRole("alert").getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(unavailableDetail.getByRole("heading", { name: "Unavailable response fixture", exact: true })).toBeVisible();
  await expect(unavailableDetail.getByText("Saved synthetic content after access change", { exact: true })).toBeVisible();

  const shared = await jsonRequest<{ id: string }>(page, `/api/memories`, "POST", { kind: "decision", scope: { kind: "organization" }, title: "Shared release standard", content: "Every release has an accountable owner.", source: { type: "user" } });
  const delayedMemory = await jsonRequest<{ id: string }>(page, `/api/memories`, "POST", { kind: "fact", scope: { kind: "user" }, title: "Delayed archive fixture", content: "Synthetic disposable memory", source: { type: "user" } });
  const archiveStarted = Promise.withResolvers<void>();
  const releaseArchive = Promise.withResolvers<void>();
  const archiveDelivered = Promise.withResolvers<void>();
  const delayedPath = `**/api/memories/${delayedMemory.id}`;
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
  const me = await jsonRequest<{ user: { id: string } }>(page, `/api/me`);
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
    for (let ordinal = 2; ordinal < 26; ordinal += 1) {
      await database.query("INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), organization.id, readyId, ordinal, `Synthetic release appendix ${ordinal + 1}.`]);
    }
    const graph = { entities: [{ key: "api", kind: "service", canonicalName: "Evidence API" }, { key: "db", kind: "database", canonicalName: "Evidence Database" }], relationships: [{ sourceKey: "api", predicate: "stores_in", targetKey: "db" }] };
    const assessment = { model: "synthetic-verifier", policyVersion: "evidence-v1", assessedAt: new Date().toISOString(),
      items: ["entity:api", "entity:db", "relationship:0"].map((item) => ({ item, verdict: "review", evidence: "", reason: "This synthetic example needs a human source check." })) };
    for (const [id, sourceChunk] of [[candidateId, chunkId], [rejectCandidateId, rejectChunkId]]) {
      await database.query("INSERT INTO knowledge_candidates (id, organization_id, document_id, chunk_id, model, graph, assessment) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, organization.id, readyId, sourceChunk, "synthetic-e2e-extractor", JSON.stringify(graph), JSON.stringify(assessment)]);
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
    const contents = page.getByRole("region", { name: "문서 내용", exact: true });
    await expect(contents.getByText("본문 25개 표시 중", { exact: true })).toBeVisible();
    await expect(contents.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toHaveCount(2);
    await expect(contents.getByText("Synthetic release appendix 26.", { exact: true })).toHaveCount(0);
    await contents.getByRole("button", { name: "본문 더 보기", exact: true }).click();
    await expect(contents.getByText("본문 26개 표시 중", { exact: true })).toBeVisible();
    await expect(contents.getByText("Synthetic release appendix 26.", { exact: true })).toBeVisible();
    await expect(contents.getByRole("button", { name: "본문 더 보기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "문서 검색 열기", exact: true })).toHaveAttribute("href", "/?kind=documents");
    await page.getByRole("button", { name: /Failed release notes/ }).click();
    await expect(contents.getByText("표시할 처리된 본문이 없습니다.", { exact: true })).toBeVisible();
    await expect(contents.getByText("Synthetic release appendix 26.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /Release source guide/ }).click();
    await expect(contents.getByText("본문 25개 표시 중", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-documents-desktop-ko.png"), fullPage: true });

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Evidence API → stores_in → Evidence Database", exact: true })).toBeVisible();
    await expect(page.getByText("검토할 지식 3개 · 추출 기록 2개", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "원문 펼치기 / 접기", exact: true }).first().click();
    await expect(page.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Release source guide · 본문 2", exact: true }).uncheck();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-review-desktop-ko.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByRole("heading", { name: "Evidence API → stores_in → Evidence Database", exact: true }).evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(240);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("after-review-mobile-ko.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "선택한 출처 1곳 승인", exact: true }).click();
    await expect(page.getByText("검토할 지식 3개 · 추출 기록 1개", { exact: true })).toBeVisible();
    const persisted = await database.query("SELECT status, item_reviews FROM knowledge_candidates WHERE id=$1", [candidateId]);
    expect(persisted.rows[0].status).toBe("accepted");
    expect(persisted.rows[0].item_reviews).toHaveLength(3);
    await page.getByLabel("검토 사유", { exact: true }).fill("Duplicate evidence is unnecessary for this example");
    await page.getByRole("button", { name: "선택한 지식 거절", exact: true }).click();
    await expect(page.getByText("검토할 지식 2개 · 추출 기록 1개", { exact: true })).toBeVisible();
    for (let remaining = 2; remaining > 0; remaining -= 1) {
      await page.getByRole("button", { name: "선택한 지식 거절", exact: true }).click();
      await expect(page.getByText(`검토할 지식 ${remaining - 1}개 · 추출 기록 ${remaining === 1 ? 0 : 1}개`, { exact: true })).toBeVisible();
    }

    await jsonRequest(page, `/api/knowledge/nodes`, "POST", { scope: { kind: "organization" }, kind: "service", canonicalName: "Evidence API", source: { memoryId: shared.id } });
    await page.goto("/?q=Evidence%20API&kind=knowledge%2Fnodes");
    await page.getByRole("button", { name: /Evidence API/ }).click();
    await expect(page.getByText("Evidence API stores release records in Evidence Database. The source requires an accountable release owner.", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("after-search-desktop-ko.png"), fullPage: true });
    await page.getByRole("button", { name: "관계 보기", exact: true }).click();
    const graphLayer = page.locator("[data-graph-layer]");
    const initialTransform = await graphLayer.getAttribute("transform");
    const graphSvg = page.locator("svg").filter({ has: page.locator("[data-graph-layer]") });
    await graphSvg.hover();
    await page.mouse.wheel(0, -240);
    await expect.poll(() => graphLayer.getAttribute("transform")).not.toBe(initialTransform);
    const graphBounds = (await graphSvg.boundingBox())!;
    const zoomedTransform = await graphLayer.getAttribute("transform");
    await page.mouse.move(graphBounds.x + 30, graphBounds.y + 160);
    await page.mouse.down(); await page.mouse.move(graphBounds.x + 85, graphBounds.y + 190, { steps: 8 }); await page.mouse.up();
    await expect.poll(() => graphLayer.getAttribute("transform")).not.toBe(zoomedTransform);
    const draggedNode = page.getByRole("button", { name: "DATABASE Evidence Database", exact: true });
    const nodePosition = await draggedNode.getAttribute("transform");
    const nodeBounds = (await draggedNode.locator("circle").last().boundingBox())!;
    await page.mouse.move(nodeBounds.x + nodeBounds.width / 2, nodeBounds.y + nodeBounds.height / 2);
    await page.mouse.down(); await page.mouse.move(nodeBounds.x + nodeBounds.width / 2 + 45, nodeBounds.y + nodeBounds.height / 2 + 25, { steps: 8 }); await page.mouse.up();
    await expect(draggedNode).toHaveAttribute("data-pinned", "true");
    await expect.poll(() => draggedNode.getAttribute("transform")).not.toBe(nodePosition);
    const pinnedPosition = await draggedNode.getAttribute("transform");
    const databaseFilter = page.getByRole("group", { name: "Node 종류 필터" }).getByRole("button", { name: /database/ });
    await databaseFilter.click();
    await expect(draggedNode).toHaveCount(0);
    await databaseFilter.click();
    await expect(draggedNode).toHaveAttribute("data-pinned", "true");
    await expect(draggedNode).toHaveAttribute("transform", pinnedPosition!);
    await draggedNode.click({ button: "right" });
    await page.getByRole("menuitem", { name: "고정 해제", exact: true }).click();
    await expect(draggedNode).not.toHaveAttribute("data-pinned", "true");
    await expect.poll(() => draggedNode.getAttribute("transform")).not.toBe(pinnedPosition);
    await draggedNode.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "고정 해제", exact: true })).toHaveCount(0);
    await page.getByRole("menu").press("Escape");
    await draggedNode.click();
    await expect(draggedNode).not.toHaveAttribute("data-pinned", "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => {
      const position = await draggedNode.getAttribute("transform");
      await page.waitForTimeout(50);
      return await draggedNode.getAttribute("transform") === position;
    }).toBe(true);
    const repinBounds = (await draggedNode.locator("circle").last().boundingBox())!;
    await page.mouse.move(repinBounds.x + repinBounds.width / 2, repinBounds.y + repinBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(repinBounds.x + repinBounds.width / 2 + 20, repinBounds.y + repinBounds.height / 2 + 15, { steps: 8 });
    await page.mouse.up();
    await expect(draggedNode).toHaveAttribute("data-pinned", "true");
    await page.getByRole("button", { name: "전체 화면", exact: true }).click();
    await expect(draggedNode).toHaveAttribute("data-pinned", "true");
    await draggedNode.click({ button: "right" });
    await page.getByRole("menuitem", { name: "고정 해제", exact: true }).click();
    await expect(draggedNode).not.toHaveAttribute("data-pinned", "true");
    const centerNode = page.getByRole("button", { name: "SERVICE Evidence API", exact: true });
    await expect(centerNode).toHaveAttribute("data-pinned", "true");
    await centerNode.click({ button: "right" });
    await page.getByRole("menuitem", { name: "고정 해제", exact: true }).click();
    await expect(centerNode).not.toHaveAttribute("data-pinned", "true");
    await page.getByRole("button", { name: "전체 화면 종료", exact: true }).click();
    await expect(draggedNode).not.toHaveAttribute("data-pinned", "true");
    await expect(centerNode).not.toHaveAttribute("data-pinned", "true");
    await databaseFilter.click();
    await databaseFilter.click();
    await expect(draggedNode).not.toHaveAttribute("data-pinned", "true");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "배치 초기화", exact: true }).click();
    await expect(draggedNode).not.toHaveAttribute("data-pinned", "true");
    await page.getByRole("button", { name: "전체 화면", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "전체 화면 종료", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("d3-graph-fullscreen-ko.png"), fullPage: true });
    await draggedNode.click({ button: "right" });
    await expect(page.getByRole("menu")).toHaveCount(1);
    await page.getByRole("button", { name: "SERVICE Evidence API", exact: true }).click({ button: "right" });
    await expect(page.getByRole("menu").getByText("Evidence Database", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("menu").getByText("Evidence API", { exact: true })).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(1);
    await page.getByRole("menu").press("Escape");
    await draggedNode.click({ button: "right" });
    await expect(page.getByRole("menu").getByText("Evidence Database", { exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "확장", exact: true })).toBeVisible();
    await expect(page.getByRole("menu")).toBeInViewport();
    await page.getByRole("menuitem", { name: "상세 보기", exact: true }).click({ trial: true });
    await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("graph-context-menu.png"), fullPage: true });
    await page.getByRole("menu").press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    await draggedNode.click({ button: "right" });
    await page.getByRole("button", { name: "SERVICE Evidence API", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(draggedNode).toHaveAttribute("data-selected", "true");
    await draggedNode.click({ button: "right" });
    const fullscreenBounds = (await graphSvg.boundingBox())!;
    await page.mouse.move(fullscreenBounds.x + 25, fullscreenBounds.y + 120);
    await page.mouse.down();
    await page.mouse.move(fullscreenBounds.x + 75, fullscreenBounds.y + 150, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(draggedNode).toHaveAttribute("data-selected", "true");
    await draggedNode.click({ button: "right" });
    await graphSvg.click({ position: { x: 25, y: 120 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(draggedNode).toHaveAttribute("data-selected", "true");
    await graphSvg.click({ position: { x: 25, y: 120 } });
    await expect(page.locator("[data-node-id][data-selected], [data-node-id][data-muted], [data-edge-id][data-muted]")).toHaveCount(0);
    await expect(page.getByText("노드를 선택하면 연결 관계와 원문 근거를 볼 수 있습니다.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "전체 화면", exact: true })).toBeFocused();

    const originalCenter = await page.locator("[data-center]").getAttribute("data-node-id");
    const databaseNodeId = (await draggedNode.getAttribute("data-node-id"))!;
    const extraNode = await jsonRequest<{ id: string }>(page, "/api/knowledge/nodes", "POST", { scope: { kind: "organization" }, kind: "service", canonicalName: "Expansion Worker", source: { memoryId: shared.id } });
    await jsonRequest(page, "/api/knowledge/edges", "POST", { scope: { kind: "organization" }, sourceNodeId: databaseNodeId, targetNodeId: extraNode.id, predicate: "uses", source: { memoryId: shared.id } });
    await draggedNode.focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "확장", exact: true }).click();
    await expect(page.getByRole("button", { name: "SERVICE Expansion Worker", exact: true })).toBeVisible();
    await expect(page.locator("[data-center]")).toHaveAttribute("data-node-id", originalCenter!);
    await expect(page.locator("[data-node-id]")).toHaveCount(3);
    await draggedNode.click({ button: "right" });
    await page.getByRole("menuitem", { name: "확장", exact: true }).click();
    await expect(page.getByRole("button", { name: "확장", exact: true })).not.toHaveAttribute("data-loading");
    await expect(page.locator("[data-node-id]")).toHaveCount(3);
    const expansionNode = page.getByRole("button", { name: "SERVICE Expansion Worker", exact: true });
    await centerNode.click({ modifiers: ["Control"] });
    await expect(page.locator("[data-node-id][data-selected]")).toHaveCount(2);
    await expect(page.locator("[data-edge-id]:visible")).toHaveCount(1);
    await expect(expansionNode).toHaveAttribute("data-muted", "true");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await centerNode.click({ button: "right" });
    await expect(page.locator("[data-node-id][data-selected]")).toHaveCount(2);
    await page.getByRole("menu").press("Escape");
    await page.getByRole("button", { name: "전체 화면", exact: true }).click();
    await expect(page.locator("[data-node-id][data-selected]")).toHaveCount(2);
    await expect(page.locator("[data-edge-id]:visible")).toHaveCount(1);
    await page.getByRole("button", { name: "전체 화면 종료", exact: true }).click();
    await expansionNode.click({ modifiers: ["Control"] });
    await expect(page.locator("[data-node-id][data-selected]")).toHaveCount(3);
    await expect(page.locator("[data-edge-id]:visible")).toHaveCount(2);
    await draggedNode.click({ modifiers: ["Control"] });
    await expect(page.locator("[data-node-id][data-selected]")).toHaveCount(2);
    await expect(page.locator("[data-edge-id]:visible")).toHaveCount(0);
    await expansionNode.click({ modifiers: ["Control"] });
    await expect(page.locator("[data-node-id][data-selected]")).toHaveCount(1);
    await expect(page.locator("[data-edge-id]:visible")).toHaveCount(0);
    await page.getByRole("button", { name: "SERVICE Evidence API", exact: true }).click();
    await expect(page.locator("[data-edge-id]:visible")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "SERVICE Expansion Worker", exact: true })).toHaveAttribute("data-muted", "true");
    await databaseFilter.click();
    await expect(draggedNode).toHaveCount(0);
    await page.getByRole("textbox", { name: "Graph node 검색", exact: true }).fill("no matching node");
    await page.getByRole("button", { name: "SERVICE Evidence API", exact: true }).click({ button: "right" });
    await graphSvg.click({ position: { x: 25, y: 120 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator("[data-node-id]")).toHaveCount(2);
    await expect(page.getByRole("textbox", { name: "Graph node 검색", exact: true })).toHaveValue("no matching node");
    await expect(databaseFilter).toHaveAttribute("aria-pressed", "false");
    await graphSvg.click({ position: { x: 25, y: 120 } });
    await expect(page.locator("[data-node-id]")).toHaveCount(3);
    await expect(page.locator("[data-node-id][data-selected], [data-node-id][data-muted], [data-edge-id][data-muted]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Graph node 검색", exact: true })).toHaveValue("");
    await expect(databaseFilter).toHaveAttribute("aria-pressed", "true");
    const neighborhoodUrl = `**/api/knowledge/nodes/${databaseNodeId}/neighborhood?*`;
    await page.getByRole("button", { name: "전체 화면", exact: true }).click();
    await page.route(neighborhoodUrl, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Expansion unavailable" }) }));
    await draggedNode.click({ button: "right" });
    await page.getByRole("menuitem", { name: "확장", exact: true }).click();
    await expect(page.getByText("Expansion unavailable", { exact: true })).toBeVisible();
    await expect(page.locator("[data-node-id]")).toHaveCount(3);
    await expect(page.locator("[data-center]")).toHaveAttribute("data-node-id", originalCenter!);
    await expect(page.getByRole("dialog").getByText("Expansion unavailable", { exact: true })).toBeVisible();
    await page.unroute(neighborhoodUrl);
    await page.getByRole("button", { name: "전체 화면 종료", exact: true }).click();
    await draggedNode.click({ button: "right" });
    await page.getByRole("menuitem", { name: "이 node 중심으로 탐색", exact: true }).click();
    await expect(draggedNode).toHaveAttribute("data-center", "true");
    await expect(page.getByText("Expansion unavailable", { exact: true })).toHaveCount(0);
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
      const session = await jsonRequest<{ user: { id: string } }>(member, "/api/auth/get-session");
      await jsonRequest(page, `/api/members/${session.user.id}`, "PATCH", { status: "active" });
      await member.goto(`/memories?memory=${shared.id}`);
      await expect(member.getByRole("heading", { name: "Shared release standard", exact: true })).toBeVisible();
      await expect(member.getByRole("tab", { name: "수정", exact: true })).toHaveCount(0);
      await expect(member.getByRole("tab", { name: "Version 이력", exact: true })).toHaveCount(0);
      await member.getByRole("button", { name: "새 Memory", exact: true }).first().click();
      await member.getByRole("dialog").filter({ has: member.getByRole("heading", { name: "새 Memory", exact: true }) }).getByRole("combobox", { name: "공유 범위" }).click();
      await expect(member.getByRole("option", { name: "조직 · 모든 조직 멤버와 공유" })).toHaveCount(0);
      await member.keyboard.press("Escape");
      await member.keyboard.press("Escape");
      const blockedWrite = await member.evaluate(async () => (await fetch(`/api/memories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "fact", title: "Disallowed organization write", content: "Must not persist", scope: { kind: "organization" }, source: { type: "user" } }) })).status);
      expect(blockedWrite).toBe(403);
      await member.goto(`/memories?memory=${memoryId}`);
      await expect(member.getByRole("heading", { name: "UI rollback policy", exact: true })).toHaveCount(0);
      await expect(member.getByRole("region", { name: "내용과 출처", exact: true }).getByRole("alert")).toBeVisible();
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
    await expect(page.getByRole("region", { name: "Document contents", exact: true }).getByText("Showing 25 sections", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true }).first()).toBeEnabled();
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
    await page.goto(`/documents?document=${readyId}`);
    await expect(page.getByRole("heading", { name: "Release source guide", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "활성 조직" })).toHaveCount(0);
    expect((await page.request.get("/api/organizations/not-this-installation/documents")).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally { await database.end(); }
});
