import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const directories: string[] = [];
const corpus = JSON.stringify({
  schemaVersion: 1,
  nodeKinds: ["service"],
  patterns: [],
  cases: [{ id: "service", content: "Orion is a service.",
    entities: [{ kind: "service", name: "Orion" }], relationships: [] }]
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "agent-memory-evaluation-"));
  directories.push(directory);
  const corpusPath = join(directory, "corpus.json");
  await writeFile(corpusPath, corpus);
  return { directory, corpusPath };
}

function run(input: {
  corpusPath: string;
  output: string;
  language: string;
  baseUrl: string;
  variants?: string;
  python?: string;
  reuse?: string;
}) {
  return execute(process.execPath, [
    "--import", "tsx", "evaluation/knowledge/run.mts",
    "--corpus", input.corpusPath, "--output", input.output,
    "--variants", input.variants ?? "single-pass",
    ...(input.python ? ["--python", input.python] : []),
    ...(input.reuse ? ["--reuse", input.reuse] : [])
  ], {
    timeout: 10_000,
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      KNOWLEDGE_EXTRACTION_MODEL: "test-model",
      KNOWLEDGE_EXTRACTION_BASE_URL: input.baseUrl,
      KNOWLEDGE_EXTRACTION_LANGUAGE: input.language
    }
  });
}

describe("knowledge evaluation CLI language", () => {
  it.each([
    ["en", "English"],
    ["source", "the language of the supplied document content"]
  ])("uses %s for the HTTP extractor, Python comparison and reusable report", async (language, instruction) => {
    const { directory, corpusPath } = await fixture();
    const prompts: string[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const input = JSON.parse(body) as { messages: { content: string }[] };
      prompts.push(input.messages[0]!.content);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ entities: [], relationships: [] }) } }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("expected local HTTP address");
      const python = join(directory, "python-mock.mjs");
      await writeFile(python, `#!/usr/bin/env node
let input = "";
for await (const chunk of process.stdin) input += chunk;
const corpus = JSON.parse(input);
for (const item of corpus.cases) {
  process.stdout.write(JSON.stringify({ id: item.id, status: "ok", milliseconds: 1, graph: {
    entities: [{ key: "entity", kind: "service", canonicalName: "Orion", evidence: [item.content], summary: corpus.language }],
    relationships: []
  } }) + "\\n");
}
`);
      await chmod(python, 0o700);
      const input = { corpusPath, language: language!, baseUrl: `http://127.0.0.1:${address.port}/v1`,
        variants: "single-pass,llamaindex", python, output: join(directory, "original") };
      await run(input);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain(`Write human-readable summaries in ${instruction}.`);
      const report = JSON.parse(await readFile(join(input.output, "summary.json"), "utf8"));
      expect(report).toMatchObject({ language, reusedExtractions: false });
      expect(report.summaries.map((summary: { errors: number }) => summary.errors)).toEqual([0, 0]);
      const pythonRows = JSON.parse(await readFile(join(input.output, "llamaindex.json"), "utf8"));
      expect(pythonRows[0].publishedGraph.entities[0].summary).toBe(language);

      const reuseOutput = join(directory, "reused");
      await run({ ...input, output: reuseOutput, reuse: input.output });
      expect(prompts).toHaveLength(1);
      expect(JSON.parse(await readFile(join(reuseOutput, "summary.json"), "utf8")))
        .toMatchObject({ language, reusedExtractions: true });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 20_000);

  it.each(["ko", undefined])("rejects reusable results with language %s before requesting a provider", async (language) => {
    const { directory, corpusPath } = await fixture();
    await writeFile(join(directory, "summary.json"), JSON.stringify({
      model: "test-model", language,
      corpusSha256: createHash("sha256").update(corpus).digest("hex")
    }));
    await expect(run({ corpusPath, output: join(directory, "output"), language: "en",
      baseUrl: "http://127.0.0.1:1/v1", reuse: directory }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("reused extraction must match the model, language and corpus") });
  }, 15_000);
});
