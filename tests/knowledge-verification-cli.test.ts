import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const execute = promisify(execFile);

describe("verification comparison CLI", () => {
  it("rejects malformed corpus data without printing its source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memory-verification-invalid-"));
    try {
      const corpus = join(directory, "corpus.json");
      await writeFile(corpus, "private-source-sentinel");
      const error = await execute(process.execPath, ["--import", "tsx", "evaluation/knowledge/verify.mts", "--corpus", corpus], {
        env: { PATH: process.env.PATH, NODE_ENV: "test" }
      }).catch((failure: { stderr: string }) => failure);
      expect(error.stderr).toContain("invalid verification corpus JSON");
      expect(error.stderr).not.toContain("private-source-sentinel");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each([true, false])("records complete evaluation outcomes when provider succeeds=%s", async (succeeds) => {
    const directory = await mkdtemp(join(tmpdir(), "memory-verification-cli-"));
    const corpus = join(directory, "corpus.json");
    await writeFile(corpus, JSON.stringify({ schemaVersion: 1, cases: [{
      id: "service", split: "validation", content: "Orion is a service.",
      graph: { entities: [{ key: "orion", kind: "service", canonicalName: "Orion" }], relationships: [] },
      target: "entity:orion", expected: "accept"
    }] }));
    const server = createServer(async (request, response) => {
      for await (const part of request) void part;
      response.writeHead(succeeds ? 200 : 503, { "Content-Type": "application/json" });
      response.end(JSON.stringify(succeeds ? { model: "resolved-test-model", usage: { cost: .0001 }, choices: [{ message: {
        content: JSON.stringify({ items: { "entity:e0": { entityKind: "service", representation: "entity", support: "explicit",
          usefulness: "useful", conflict: false, evidenceId: "s0", reason: "The source identifies this service." } } })
      } }] } : { error: "private-provider-sentinel" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test server address");
      const run = execute(process.execPath, ["--import", "tsx", "evaluation/knowledge/verify.mts", "--variants", "chat",
        "--corpus", corpus, "--output", directory], { timeout: 10_000, env: {
        PATH: process.env.PATH, NODE_ENV: "test", KNOWLEDGE_EXTRACTION_MODEL: "test-model",
        KNOWLEDGE_EXTRACTION_BASE_URL: `http://127.0.0.1:${address.port}/v1`
      } });
      if (succeeds) await run;
      else await expect(run).rejects.toMatchObject({ code: 1 });
      const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
      expect(summary.summaries[0]).toMatchObject({ expectedCases: 1, completedCases: 1, errors: succeeds ? 0 : 1,
        acceptedSupported: succeeds ? 1 : 0, unsafeAccepted: 0, supportedRecall: succeeds ? 1 : 0,
        costUsd: succeeds ? .0001 : null });
      const rows = await readFile(join(directory, "chat.json"), "utf8");
      expect(rows).not.toContain("private-provider-sentinel");
      expect(JSON.parse(rows)[0]).toMatchObject({ status: succeeds ? "ok" : "error" });
      if (succeeds) expect(JSON.parse(rows)[0].requestMetrics[0].model).toBe("resolved-test-model");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
