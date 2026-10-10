import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { resetInstallationFixture } from "./installation-fixture";

test("shows historical assessments even when the current comparison is no longer shareable", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable authenticated test database");
  await resetInstallationFixture();
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { Origin: "http://127.0.0.1:3110", "x-forwarded-for": "192.0.2.97" },
    data: { email: `e2e+${process.env.E2E_RUN_ID}-${testInfo.retry}@nalbam.com`, name: "Assessment Operator", password: "agent-memory-e2e-password" }
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/review");
  const me = await (await page.request.get("/api/me")).json() as { organizationId: string; user: { id: string } };
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const privateDocument = randomUUID(), privateChunk = randomUUID();
  try {
    await database.query("INSERT INTO documents(id,organization_id,scope_kind,user_id,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'user',$3,'Private context','history-private','checksum','text/plain','ready',$3)", [privateDocument, me.organizationId, me.user.id]);
    await database.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,'Private comparison context.')", [privateChunk, me.organizationId, privateDocument]);
    for (const title of ["History A", "History B"]) {
      const documentId = randomUUID(), chunkId = randomUUID();
      await database.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization',$3,$5,'checksum','text/plain','ready',$4)", [documentId, me.organizationId, title, me.user.id, documentId]);
      await database.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,'Atlas is a service.')", [chunkId, me.organizationId, documentId]);
      const previous = { model: "previous-verifier", policyVersion: "prior-policy", assessedAt: "2026-10-01T00:00:00Z",
        sources: [{ chunkId }], contextNodeIds: [],
        items: [{ item: "entity:atlas", verdict: "review", evidence: "Atlas is a service.", reason: `${title}: previous public assessment` }] };
      const current = { ...previous, model: "current-verifier", policyVersion: "current-policy", assessedAt: "2026-10-02T00:00:00Z",
        sources: title === "History A" ? [{ chunkId }] : [{ chunkId }, { chunkId: privateChunk }],
        items: [{ ...previous.items[0], verdict: "accept", reason: title === "History A" ? "Current public assessment" : "Private assessment sentinel" }] };
      await database.query("INSERT INTO knowledge_candidates(id,organization_id,document_id,chunk_id,model,graph,assessment,assessment_history) VALUES($1,$2,$3,$4,'extractor',$5,$6,$7)", [randomUUID(), me.organizationId, documentId, chunkId,
        JSON.stringify({ entities: [{ key: "atlas", canonicalName: "Atlas", kind: "service" }], relationships: [] }), JSON.stringify(current), JSON.stringify([previous])]);
    }
  } finally { await database.end(); }

  const response = await page.request.get("/api/knowledge/curation");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.sources).toHaveLength(2);
  expect(JSON.stringify(body)).not.toContain("Private assessment sentinel");
  await page.getByRole("tab", { name: "Curation history", exact: true }).click();
  await page.getByRole("button", { name: /^History A/ }).click();
  await expect(page.getByText("Current public assessment", { exact: true })).toBeVisible();
  await expect(page.getByText("History A: previous public assessment", { exact: true })).toBeVisible();
  await expect(page.getByText("Verification: eligible for approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Verification: human review needed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^History B/ }).click();
  await expect(page.getByText("History B: previous public assessment", { exact: true })).toBeVisible();
  await expect(page.getByText(/previous-verifier · prior-policy/)).toBeVisible();
  await expect(page.getByText("Current assessment", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Private assessment sentinel", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("knowledge-assessment-history.png"), fullPage: true, animations: "disabled" });
});
