import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { resetInstallationFixture } from "./installation-fixture";

test("finds the same knowledge entity by its verified aliases and shows their provenance", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable PostgreSQL database");
  await resetInstallationFixture();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
  const headers = { Origin: "http://127.0.0.1:3110", "x-forwarded-for": "192.0.2.92" };
  const signup = await page.request.post("/api/auth/sign-up/email", { headers,
    data: { email: `e2e+${process.env.E2E_RUN_ID}-${testInfo.retry}@nalbam.com`, name: "Alias Reviewer", password: "agent-memory-e2e-password" } });
  expect(signup.ok()).toBe(true);
  await page.goto("/knowledge");
  const me = await (await page.request.get("/api/me")).json() as { organizationId: string; user: { id: string } };
  const database = new Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  let entityId: string | undefined;
  let aliasDocumentId: string | undefined;
  try {
    for (const name of ["제갈량", "공명", "제갈공명"]) {
      const documentId = randomUUID(), chunkId = randomUUID(), candidateId = randomUUID();
      const content = name === "제갈량" ? "제갈량의 자는 공명이고 제갈공명 또는 와룡이라고도 불린다." : `${name}은 군사를 지휘했다.`;
      const aliases = name === "제갈량" ? ["공명", "제갈공명", "와룡"] : [];
      if (name === "제갈량") aliasDocumentId = documentId;
      await database.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization','Alias source','alias-fixture','checksum','text/plain','ready',$3)", [documentId, me.organizationId, me.user.id]);
      await database.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,$4)", [chunkId, me.organizationId, documentId, content]);
      const graph = { entities: [{ key: "person", canonicalName: name, kind: "person", aliases, evidence: [content], summary: content }], relationships: [] };
      await database.query("INSERT INTO knowledge_candidates(id,organization_id,document_id,chunk_id,model,graph) VALUES($1,$2,$3,$4,'synthetic-extractor',$5)", [candidateId, me.organizationId, documentId, chunkId, JSON.stringify(graph)]);
      const response = await page.request.post(`/api/knowledge/candidates/${candidateId}/accept`, { headers, data: {} });
      expect(response.status()).toBe(200);
      const result = await response.json() as { nodes: { id: string; canonicalName: string; aliases: string[] }[] };
      entityId ??= result.nodes[0]!.id;
      expect(result.nodes.map((node) => node.id)).toEqual([entityId]);
      expect(result.nodes[0]?.canonicalName).toBe("제갈량");
    }
    for (const name of ["제갈량", "공명", "제갈공명"]) {
      const result = await (await page.request.get(`/api/knowledge/nodes?q=${encodeURIComponent(name)}`)).json() as { hits: { node: { id: string } }[] };
      expect(result.hits.map((hit) => hit.node.id)).toEqual([entityId]);
      await page.goto(`/knowledge?q=${encodeURIComponent(name)}`);
      const hit = page.getByRole("button", { name: /^제갈량 ·/ });
      await expect(hit).toHaveCount(1);
      await hit.click();
      await expect(page.getByText(/^검증된 별칭:/)).toContainText("공명");
      await expect(page.getByText(/^검증된 별칭:/)).toContainText("제갈공명");
    }
    await page.getByRole("button", { name: "관계 보기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "제갈량", exact: true })).toBeVisible();
    await expect(page.getByText(/^검증된 별칭:/)).toContainText("와룡");
    await page.getByRole("textbox", { name: "Graph node 검색", exact: true }).fill("공명");
    await expect(page.getByText("노드 목록 · 1", { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath("verified-knowledge-aliases.png"), fullPage: true });
    expect((await page.request.delete(`/api/documents/${aliasDocumentId}`, { headers })).status()).toBe(204);
    const hidden = await (await page.request.get(`/api/knowledge/nodes?q=${encodeURIComponent("와룡")}`)).json() as { hits: unknown[] };
    expect(hidden.hits).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await database.end();
  }
});
