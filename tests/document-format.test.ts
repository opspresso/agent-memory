import { describe, expect, it } from "vitest";
import { resolveDocumentMimeType } from "@/domain/document/document-format";
import { documentIngestSchema } from "@/lib/document-schemas";

describe("document format resolution", () => {
  it.each([
    ["notes.MD", "", "text/markdown"],
    ["notes.markdown", "text/plain", "text/markdown"],
    ["data.csv", "text/plain", "text/csv"],
    ["report.PDF", "application/octet-stream", "application/pdf"],
    ["book.epub", "application/zip", "application/epub+zip"],
    ["notes.html", "text/plain", "text/html"],
    ["notes.html", "application/xhtml+xml", "text/html"],
    ["data.xml", "text/xml; charset=utf-8", "text/xml"],
    ["document", "APPLICATION/PDF", "application/pdf"]
  ])("resolves %s with %s", (name, mimeType, expected) => {
    expect(resolveDocumentMimeType(name, mimeType)).toBe(expected);
  });

  it.each([
    ["report.pdf", "text/plain"], ["report.pdf", "text/html"],
    ["notes.md", "application/pdf"], ["data.zip", "application/zip"],
    ["old.doc", "application/msword"], ["image.png", "image/png"],
    ["document", "application/octet-stream"]
  ])("rejects unsupported or conflicting metadata: %s / %s", (name, mimeType) => {
    expect(resolveDocumentMimeType(name, mimeType)).toBeUndefined();
  });
});

describe("MCP document bytes", () => {
  const input = { idempotencyKey: "upload-1", scope: { kind: "user" }, title: "Report", mimeType: "application/pdf" };

  it("requires explicit base64 for binary formats", () => {
    expect(documentIngestSchema.safeParse({ ...input, content: "%PDF" }).success).toBe(false);
    expect(documentIngestSchema.parse({ ...input, contentEncoding: "base64", content: "JVBERg==" }).content).toBe("JVBERg==");
  });

  it.each(["!bad", "JVBERg", "JVBE Rg==", "JVBERh==", "=", "JVBERg==\n"])("rejects noncanonical base64 %s", (content) => {
    expect(documentIngestSchema.safeParse({ ...input, contentEncoding: "base64", content }).success).toBe(false);
  });

  it("applies the original-byte limit to base64", () => {
    const content = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    expect(documentIngestSchema.safeParse({ ...input, contentEncoding: "base64", content }).success).toBe(false);
  });

  it("keeps text input in UTF-8 by default", () => {
    expect(documentIngestSchema.parse({ ...input, mimeType: "text/markdown", content: "# 한글" }).contentEncoding).toBe("utf8");
  });
});
