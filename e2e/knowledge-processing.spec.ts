import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { resetInstallationFixture } from "./installation-fixture";

test("requeues unextracted chunks from the graph without a search term", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true" || !process.env.KNOWLEDGE_EXTRACTION_MODEL || process.env.DOCUMENT_WORKER_ENABLED !== "false", "requires a disposable database and an extraction model with the worker disabled");
  await resetInstallationFixture();
  await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { Origin: "http://127.0.0.1:3110", "x-forwarded-for": "192.0.2.91" },
    data: { email: `e2e+${process.env.E2E_RUN_ID}-${testInfo.retry}@nalbam.com`, name: "Knowledge Operator", password: "agent-memory-e2e-password" }
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/knowledge");
  const me = await (await page.request.get("/api/me")).json() as { organizationId: string; user: { id: string } };
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const documentId = randomUUID(), chunkId = randomUUID();
  try {
    await database.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization','Retry fixture','retry-fixture','retry-checksum','text/plain','ready',$3)", [documentId, me.organizationId, me.user.id]);
    await database.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,'Synthetic source for retry.')", [chunkId, me.organizationId, documentId]);
    await page.reload();
    await expect(page.getByText("전체 1개 청크 중 추출 0개 · 검증 및 자동 반영 0개 완료", { exact: true })).toBeVisible();
    const retry = page.getByRole("button", { name: "미완료 지식 처리 재시도", exact: true });
    await retry.click();
    await expect(page.getByRole("status")).toHaveText("미완료 청크 1개를 처리하도록 등록했습니다.");
    await retry.click();
    await expect(page.getByRole("status")).toHaveText("미완료 청크 0개를 처리하도록 등록했습니다.");
    const jobs = await database.query("SELECT data FROM pgboss.job WHERE name='document-knowledge-enrichment-v2' AND data->>'chunkId'=$1 AND state IN ('created','active','retry')", [chunkId]);
    expect(jobs.rows).toEqual([{ data: { organizationId: me.organizationId, chunkId, requestedBy: me.user.id } }]);
    await page.screenshot({ path: testInfo.outputPath("knowledge-processing-retry.png"), fullPage: true });
  } finally {
    await database.end();
  }
});
