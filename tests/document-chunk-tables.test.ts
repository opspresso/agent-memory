import { describe, expect, it } from "vitest";
import { chunkDocumentText } from "@/application/document/chunk-text";

const header = "| Product | Owner |\n| --- | --- |";
const rows = Array.from({ length: 180 }, (_, index) => `| Orion-${index} | Owner-${index} |`);

describe("table chunk context", () => {
  it.each(["", "# Handbook\n\n## Inventory\n\n"])("preserves complete rows and column names after %j", (prefix) => {
    const source = prefix + header + "\n" + rows.join("\n");
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain(header + "\n");
      expect(chunk.content.length).toBeLessThanOrEqual(2_000);
      if (prefix) expect(chunk.content).toContain("# Handbook\n## Inventory");
      const body = source.slice(chunk.start, chunk.end);
      expect(body.startsWith("| Product |") || body.startsWith("| Orion-")).toBe(true);
      expect(body.endsWith(" |")).toBe(true);
      for (const span of chunk.contextSpans ?? []) {
        expect(chunk.content).toContain(source.slice(span.start, span.end));
      }
    }
    for (const row of rows) expect(chunks.filter((chunk) => chunk.content.includes(row))).toHaveLength(1);
    expect(chunks.at(-1)?.contextSpans).toContainEqual({ start: prefix.length, end: prefix.length + header.length });
  });

  it("keeps prose and separate table headers in their own context", () => {
    const first = "| First | Value |\n| --- | --- |\n| Alpha | 1 |";
    const second = "| Second | Owner |\n| --- | --- |\n| Beta | Kim |";
    const chunks = chunkDocumentText(`# Handbook\n\nIntroduction.\n\n${first}\n\nBetween tables.\n\n${second}\n\nConclusion.`, "text/markdown");
    const content = chunks.map((chunk) => chunk.content).join("\n");
    for (const text of ["Introduction.", "Between tables.", "Conclusion."]) expect(content).toContain(text);
    expect(chunks.find((chunk) => chunk.content.includes("Alpha"))?.content).not.toContain("| Second |");
    expect(chunks.find((chunk) => chunk.content.includes("Beta"))?.content).not.toContain("| First |");
  });

  it("ignores table examples inside backtick and tilde fences", () => {
    for (const fence of ["```", "~~~~"]) {
      const source = `${fence}markdown\n${header}\n${rows.join("\n")}\n${fence}`;
      const chunks = chunkDocumentText(source, "text/markdown");
      expect(chunks).toHaveLength(3);
      expect(chunks.slice(1).every((chunk) => !chunk.content.includes("Product"))).toBe(true);
      expect(chunks.every((chunk) => chunk.contextSpans === undefined)).toBe(true);
    }
  });

  it.each([
    ["Name \\| alias | Value\n:--- | ---:", "Orion \\| Moon | 1"],
    ["| Name |\n| --- |", "| Orion |"],
    ["Name | Value\n--- | ---", "Orion | 1"]
  ])("recognizes escaped pipes and optional outer pipes in %s", (tableHeader, row) => {
    const chunks = chunkDocumentText(tableHeader + "\n" + Array.from({ length: 300 }, () => row).join("\n"), "text/markdown");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.startsWith(tableHeader + "\n"))).toBe(true);
  });

  it("does not repeat table-like text inside an indented code block", () => {
    const source = [header, ...rows].join("\n").split("\n").map((line) => "    " + line).join("\n");
    const chunks = chunkDocumentText("Example:\n\n" + source, "text/markdown");
    expect(chunks.slice(1).every((chunk) => !chunk.content.includes("Product"))).toBe(true);
    expect(chunks.every((chunk) => chunk.contextSpans === undefined)).toBe(true);
  });

  it("preserves source coverage and headers when one row must be split", () => {
    const source = `# Inventory\n\n${header}\n| Large item | ${"data ".repeat(1000)}|\n| Last item | Kim |`;
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks.length).toBeGreaterThan(2);
    const covered = new Set<number>();
    for (const chunk of chunks) {
      expect(chunk.content).toContain("# Inventory");
      expect(chunk.content).toContain(header);
      expect(chunk.content.length).toBeLessThanOrEqual(2_000);
      for (const span of [{ start: chunk.start, end: chunk.end }, ...(chunk.contextSpans ?? [])]) {
        for (let index = span.start; index < span.end; index += 1) covered.add(index);
      }
    }
    expect([...source].every((character, index) => /\s/.test(character) || covered.has(index))).toBe(true);
    expect(chunks.at(-1)?.content).toContain("| Last item | Kim |");
  });

  it("bounds chunks when the table header itself consumes the context budget", () => {
    const source = `| ${"column".repeat(400)} |\n| --- |\n| Value |`;
    const chunks = chunkDocumentText(source, "text/markdown");
    expect(chunks.every((chunk) => chunk.content.length <= 2_000)).toBe(true);
    expect(chunks.at(-1)?.content).toContain("| Value |");
  });

  it("keeps CSV header context around a single oversized record", () => {
    const chunks = chunkDocumentText(`name,notes\nOrion,"${"entry ".repeat(800)}"\nPolaris,complete`, "text/csv");
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.content.startsWith("name,notes\n"))).toBe(true);
    expect(chunks.at(-1)?.content).toContain("Polaris,complete");
  });
});
