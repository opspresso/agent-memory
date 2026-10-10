import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildProcessDocument } from "@/application/document/process-document";
import { chunkDocumentText } from "@/application/document/chunk-text";
import { createDocument, InvalidDocumentError } from "@/domain/document/document";
import { documentFormats } from "@/domain/document/document-format";
import type { DocumentRepository } from "@/domain/document/document-repository";
import { createMarkItDownTextExtractor } from "@/infrastructure/document/markitdown-text-extractor";

const pythonPath = process.env.DOCUMENT_PARSER_PYTHON ?? resolve(".venv-document-parser/bin/python");
const parser = createMarkItDownTextExtractor({ pythonPath });
const fixture = (name: string) => readFile(resolve("tests/fixtures/documents", name));

describe("uploaded document conversion", () => {
  const convertedFormats = Object.entries(documentFormats).filter(([mimeType, format]) => mimeType !== format.textMimeType);
  it.each(convertedFormats)("extracts a real %s file as Markdown", async (mimeType, format) => {
    const result = await parser.extract(await fixture(`sample${format.extensions[0]}`), mimeType);
    expect(result.mimeType).toBe("text/markdown");
    expect(result.text).toContain("Orion");
    if (mimeType !== "application/pdf") expect(result.text).toMatch(/김하늘|문서 파싱 검증/);
    if (mimeType === "text/html") {
      expect(result.text).toContain("# Orion handbook");
      expect(result.text).toContain("| Product | Owner |");
      expect(result.text).not.toMatch(/hidden-script|hidden-style/);
    }
    if (mimeType.endsWith("presentation")) expect(result.text).toContain("Review the source document.");
    if (mimeType.endsWith("sheet")) expect(result.text).toContain("## Second sheet");
  }, 15_000);

  it.each([
    ["wrong.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "damaged"],
    ["oversized.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "64 MiB"],
    ["empty.pdf", "application/pdf", "no extractable text"],
    ["sample.docx", "application/pdf", "damaged"],
    ["sample.html", "application/vnd.ms-excel", "damaged"]
  ])("rejects %s as %s", async (filename, mimeType, message) => {
    await expect(parser.extract(await fixture(filename), mimeType)).rejects.toThrow(message);
  }, 15_000);

  it("does not fetch remote HTML resources", async () => {
    const result = await parser.extract(Buffer.from('<h1>Offline</h1><img src="http://127.0.0.1:1/private"><a href="file:///etc/passwd">reference</a>'), "text/html");
    expect(result.text).toContain("# Offline");
    expect(result.text).not.toContain("root:");
  });

  it("reports the UTF-8 requirement without exposing invalid HTML source", async () => {
    const source = Buffer.from("<p>private-document-sentinel caf\u00e9</p>", "latin1");
    const error = await parser.extract(source, "text/html").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidDocumentError);
    expect(String(error)).toContain("valid UTF-8");
    expect(String(error)).not.toContain("private-document-sentinel");
  });

  it("uses the native path for UTF-8 text without starting Python", async () => {
    const native = createMarkItDownTextExtractor({ pythonPath: "/missing-python" });
    await expect(native.extract(Buffer.from("# 한글"), "text/markdown"))
      .resolves.toEqual({ text: "# 한글", mimeType: "text/markdown" });
    await expect(native.extract(new Uint8Array([0xff]), "text/plain")).rejects.toThrow("valid UTF-8");
    await expect(native.extract(Buffer.from("binary\0value"), "text/plain")).rejects.toThrow("binary data");
    await expect(native.extract(Buffer.from("value"), "application/zip")).rejects.toThrow("unsupported");
  });

  it("does not include malformed JSON source in errors", () => {
    const invalid = '{"private-document-sentinel": invalid}';
    expect(() => chunkDocumentText(invalid, "application/json")).toThrow("document contains invalid JSON");
    try { chunkDocumentText(invalid, "application/json"); } catch (error) {
      expect(String(error)).not.toContain("private-document-sentinel");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("processes converted headings with Markdown scope and records the text representation", async () => {
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const content = await fixture("sample.docx");
    const document = createDocument({ id: "doc", scope: { organizationId: "org", kind: "organization" },
      title: "Orion", objectKey: "source", checksum: "a".repeat(64), mimeType,
      sizeBytes: content.byteLength, createdBy: "user", now: new Date() });
    const completeProcessing = vi.fn<DocumentRepository["completeProcessing"]>();
    const processDocument = buildProcessDocument({ accessRepository: { findByUser: vi.fn().mockResolvedValue({ organizationId: "org", userId: "user", role: "owner", teams: [] }) }, clock: () => new Date(), generateId: () => "chunk",
      objectStorage: { get: async () => content, put: vi.fn(), delete: vi.fn() },
      textExtractor: parser,
      repository: { findById: vi.fn().mockResolvedValue({ ...document, status: "processing" }), claimForProcessing: vi.fn().mockResolvedValue({ document, leaseId: "lease" }),
        completeProcessing, failProcessing: vi.fn(), deferProcessing: vi.fn() }
    });
    await processDocument("org", "doc", document.processingGeneration, "user");
    expect(completeProcessing).toHaveBeenCalledOnce();
    expect(completeProcessing.mock.calls[0]?.[1][0]).toMatchObject({
      content: expect.stringContaining("# Orion handbook"), metadata: { textMimeType: "text/markdown" }
    });
    expect(document.mimeType).toBe(mimeType);
  });

  it("keeps spreadsheet column names and complete rows in every search chunk", async () => {
    const extracted = await parser.extract(await fixture("table.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const chunks = chunkDocumentText(extracted.text, extracted.mimeType);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain("## Inventory");
      expect(chunk.content).toContain("| Product | Owner |");
      expect(chunk.content.length).toBeLessThanOrEqual(2_000);
    }
    for (let index = 0; index < 180; index += 1) {
      expect(chunks.filter((chunk) => chunk.content.includes(`| Orion-${index} | Owner-${index} |`))).toHaveLength(1);
    }
  });
});

describe("parser process boundary", () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "document-parser-test-")); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  afterEach(() => { vi.unstubAllEnvs(); });
  async function script(source: string, timeoutMilliseconds?: number) {
    const scriptPath = join(directory, `${crypto.randomUUID()}.py`);
    await writeFile(scriptPath, source);
    return createMarkItDownTextExtractor({ pythonPath, scriptPath, timeoutMilliseconds });
  }

  it("converts without creating native telemetry files in its working directory", async () => {
    const cwd = await mkdtemp(join(directory, "isolated-"));
    const result = spawnSync(pythonPath, ["-I", resolve("src/infrastructure/document/convert_document.py"), "text/html"], {
      cwd, input: "<h1>Orion</h1>", encoding: "utf8", timeout: 10_000,
      env: { NODE_ENV: "test", PATH: process.env.PATH, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" }
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ text: "# Orion" });
    expect(await readdir(cwd)).toEqual([]);
    expect(result.stderr).not.toContain("telemetry");
  });

  it("terminates a timed-out converter", async () => {
    const extractor = await script("import time\ntime.sleep(60)", 50);
    await expect(extractor.extract(Buffer.from("file"), "application/pdf")).rejects.toThrow("time limit");
  });

  it("bounds process output", async () => {
    const extractor = await script('import sys\nsys.stdout.write("x" * (8 * 1024 * 1024 + 1))');
    await expect(extractor.extract(Buffer.from("file"), "application/pdf")).rejects.toThrow("8 MiB");
  });

  it("does not forward application credentials to the converter", async () => {
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "fake-secret-sentinel");
    const extractor = await script('import os,json\nprint(json.dumps({"text": str("S3_SECRET_ACCESS_KEY" in os.environ), "mimeType":"text/markdown"}))');
    await expect(extractor.extract(Buffer.from("file"), "application/pdf"))
      .resolves.toEqual({ text: "False", mimeType: "text/markdown" });
  });

  it.each([
    'import sys\nprint("private-document-sentinel")\nprint("private-document-sentinel", file=sys.stderr)\nsys.exit(2)',
    'import json,sys\nprint(json.dumps({"error":"private-document-sentinel"}))\nsys.exit(2)',
    'import sys\nsys.exit(0)'
  ])("keeps invalid protocol output out of exceptions", async (source) => {
    const extractor = await script(source);
    const error = await extractor.extract(Buffer.from("file"), "application/pdf").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("private-document-sentinel");
    expect(error).not.toHaveProperty("cause");
  });

  it("reports a missing parser runtime separately from invalid documents", async () => {
    const extractor = createMarkItDownTextExtractor({ pythonPath: "/missing-python" });
    const error = await extractor.extract(Buffer.from("file"), "application/pdf").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidDocumentError);
    expect(String(error)).toContain("DOCUMENT_PARSER_PYTHON");
  });
});
