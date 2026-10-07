import { describe, expect, it } from "vitest";
import { chunkDocumentText } from "@/application/document/chunk-text";
import { InvalidDocumentError } from "@/domain/document/document";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

describe("document chunk work budget", () => {
  it.each(["pipe-prose", "table", "headings", "wide-header", "wide-row"])("rejects oversized %s without exhausting the worker heap", (format) => {
    const moduleUrl = pathToFileURL(resolve("src/application/document/chunk-text.ts")).href;
    const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "--input-type=module", "--eval", `
      import { chunkDocumentText } from ${JSON.stringify(moduleUrl)};
      const format = ${JSON.stringify(format)};
      const source = format === "headings" ? "# A\\nx\\n".repeat(1_000_000)
        : format === "wide-header" ? "|".repeat(8_000_000) + "\\n-| -"
        : format === "wide-row" ? "A|B\\n-| -\\n" + "|".repeat(8_000_000)
        : (format === "table" ? "A|B\\n-| -\\n" : "") + "a|b\\n".repeat(2_000_000);
      try { chunkDocumentText(source, "text/markdown"); process.exitCode = 1; }
      catch (error) { console.log(error.message); }
    `], { encoding: "utf8", timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("document exceeds the 512 chunk processing limit");
  });

  it("accepts exactly 512 Markdown sections and rejects the next section", () => {
    const source = Array.from({ length: 512 }, (_, index) => `# Section ${index}\n\nBody ${index}.`).join("\n\n");
    expect(chunkDocumentText(source, "text/markdown")).toHaveLength(512);
    expect(() => chunkDocumentText(source + "\n\n# Extra\n\nMore content.", "text/markdown"))
      .toThrow("document exceeds the 512 chunk processing limit");
  });

  it.each(["text/plain", "text/csv", "application/xml", "text/markdown"])("rejects oversized %s while constructing chunks", (mimeType) => {
    const source = "name,value\n" + "long record ".repeat(110_000);
    expect(() => chunkDocumentText(source, mimeType)).toThrow(InvalidDocumentError);
  });

  it("bounds expanded JSON paths even when the original file is small", () => {
    const source = JSON.stringify({ ["p".repeat(20_000)]: Array.from({ length: 70 }, () => 1) });
    expect(source.length).toBeLessThan(21_000);
    expect(() => chunkDocumentText(source, "application/json"))
      .toThrow("document exceeds the 512 chunk processing limit");
  });

  it("keeps JSON value order, empty containers and escaped property names", () => {
    const chunks = chunkDocumentText('{"array":[false,null,{},[]],"a.b":{"x y":0},"tail":"value"}', "application/json");
    expect(chunks[0]?.content).toBe([
      "$.array[0] = false", "$.array[1] = null", "$.array[2] = {}", "$.array[3] = []",
      '$["a.b"]["x y"] = 0', '$.tail = "value"'
    ].join("\n"));
  });
});
