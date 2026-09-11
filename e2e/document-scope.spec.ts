import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { resetInstallationFixture } from "./installation-fixture";

async function json<T>(page: Page, url: string, method = "GET", body?: unknown, headers?: Record<string, string>): Promise<T> {
  return page.evaluate(async ({ url, method, body, headers }) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(`Scope fixture request failed: ${response.status}`);
    return value;
  }, { url, method, body, headers });
}

test("changes document sharing with verified knowledge, reports exclusions and prevents stale overwrites", async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable PostgreSQL database");
  test.setTimeout(120_000);
  await resetInstallationFixture();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/_(e2e|test)$/.test(new URL(databaseUrl).pathname.slice(1))) throw new Error("A disposable database is required");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.81" });
  await page.goto("/");
  await page.getByText("가입", { exact: true }).click();
  await page.getByLabel("이름").fill("Scope Operator");
  await page.getByLabel("이메일").fill(`e2e+${process.env.E2E_RUN_ID}-${testInfo.retry}@nalbam.com`);
  await page.getByLabel("비밀번호").fill("agent-memory-e2e-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page.getByRole("heading", { name: "통합 검색", exact: true })).toBeVisible();
  const me = await json<{ organizationId: string; user: { id: string } }>(page, "/api/me");
  const docId = randomUUID(), otherId = randomUUID(), chunkId = randomUUID(), otherChunk = randomUUID();
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    for (const [id, chunk, title] of [[docId, chunkId, "삼국지 1권"], [otherId, otherChunk, "삼국지 2권"]]) {
      await database.query("INSERT INTO documents (id, organization_id, scope_kind, user_id, title, object_key, checksum, mime_type, status, created_by) VALUES ($1,$2,'user',$3,$4,$5,$5,'text/plain','ready',$3)", [id, me.organizationId, me.user.id, title, id]);
      await database.query("INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content) VALUES ($1,$2,$3,0,'유비와 관우는 의형제다.')", [chunk, me.organizationId, id]);
    }
  } finally { await database.end(); }
  const node = (name: string, chunk: string) => json<{ id: string }>(page, "/api/knowledge/nodes", "POST", { scope: { kind: "user" }, kind: "person", canonicalName: name, source: { chunkId: chunk } });
  const a = await node("유비", chunkId), b = await node("관우", chunkId);
  await node("유비", otherChunk);
  await json(page, "/api/knowledge/edges", "POST", { scope: { kind: "user" }, sourceNodeId: a.id, targetNodeId: b.id, predicate: "related_to", source: { chunkId } });

  // A separate signed-in member checks the actual visibility after sharing.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.82" });
  const signup = await memberPage.request.post("/api/auth/sign-up/email", { data: { email: `scope-member+${process.env.E2E_RUN_ID}@nalbam.com`, name: "Scope Reader", password: "agent-memory-e2e-password" }, headers: { Origin: "http://127.0.0.1:3110" } });
  expect(signup.ok()).toBe(true);
  const member = await signup.json() as { user: { id: string } };
  await memberPage.goto("/");
  await expect(memberPage.getByText("Your membership is awaiting approval by an organization administrator.", { exact: true })).toBeVisible();
  await json(page, `/api/members/${member.user.id}`, "PATCH", { status: "active" });
  expect((await memberPage.request.get(`/api/documents/${docId}`)).status()).toBe(404);

  await page.goto(`/documents?document=${docId}`);
  await page.getByRole("button", { name: "공유 범위 변경", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "공유 범위 변경", exact: true });
  await modal.getByRole("combobox", { name: "공유 범위", exact: true }).click();
  await page.getByRole("option", { name: "조직 · 모든 조직 멤버와 공유", exact: true }).click();
  await modal.screenshot({ path: testInfo.outputPath("document-scope-dialog-ko.png") });
  await modal.getByRole("button", { name: "범위 적용", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText("개체: 변경 1개 · 동일 범위 0개 · 제외 1개", { exact: true })).toBeVisible();
  await expect(page.getByText("관계: 변경 0개 · 동일 범위 0개 · 제외 1개", { exact: true })).toBeVisible();
  await expect(page.getByText(/다른 출처의 공개 범위 불충족 \(1\)/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("document-scope-result-ko.png"), fullPage: true });
  expect((await memberPage.request.get(`/api/documents/${docId}`)).status()).toBe(200);
  const visible = await memberPage.request.get(`/api/knowledge/nodes?q=${encodeURIComponent("유비")}`);
  expect((await visible.json()).hits).toEqual([]);
  await memberPage.goto(`/documents?document=${docId}`);
  await expect(memberPage.getByRole("button", { name: "Change sharing scope" })).toHaveCount(0);

  // Sharing the remaining source and applying the same scope again unlocks the relation.
  for (const id of [otherId, docId]) {
    const doc = await json<{ updatedAt: string }>(page, `/api/documents/${id}`);
    await json(page, `/api/documents/${id}`, "PATCH", { scope: { kind: "organization" } }, { "If-Match": `"${doc.updatedAt}"` });
  }
  await page.reload();
  await page.getByRole("button", { name: "공유 범위 변경", exact: true }).click();
  // Update through a second request after the editor took its snapshot.
  const latest = await json<{ updatedAt: string }>(page, `/api/documents/${docId}`);
  await json(page, `/api/documents/${docId}`, "PATCH", { scope: { kind: "organization" } }, { "If-Match": `"${latest.updatedAt}"` });
  await modal.getByRole("button", { name: "범위 적용", exact: true }).click();
  await expect(modal.getByText("문서가 변경되었습니다. 새로고침하여 최신 범위를 확인한 뒤 다시 적용하세요.")).toBeVisible();
  await expect(modal.getByRole("button", { name: "범위 적용", exact: true })).toBeDisabled();
  await modal.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "공유 범위 변경", exact: true }).click();
  await modal.screenshot({ path: testInfo.outputPath("document-scope-mobile-ko.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await modal.getByRole("button", { name: "범위 적용", exact: true }).click();
  await expect(page.getByText("개체: 변경 0개 · 동일 범위 2개 · 제외 0개", { exact: true })).toBeVisible();
  await expect(page.getByText("관계: 변경 0개 · 동일 범위 1개 · 제외 0개", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await memberContext.close();
});
