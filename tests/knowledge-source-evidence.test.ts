import { describe, expect, it } from "vitest";
import { sourceEvidencePassages } from "@/infrastructure/ai/knowledge-source-evidence";

describe("source evidence choices", () => {
  it("offers exact heading and fact passages without synthesized ellipses", () => {
    const content = "# 김하늘\n\n## 기술\n\nTypeScript · Redis";
    const choices = sourceEvidencePassages(content).map((passage) => passage.text);
    expect(choices).toContain(content);
    expect(choices).toContain("# 김하늘");
    expect(choices).toContain("TypeScript · Redis");
    expect(choices.every((choice) => choice.length > 0 && content.includes(choice))).toBe(true);
  });
  it("keeps long-line evidence bounded and available at both ends of the source", () => {
    const content = `처음 ${"가".repeat(4_000)} 마지막`;
    const choices = sourceEvidencePassages(content).map((passage) => passage.text);
    expect(choices.length).toBeGreaterThan(1);
    expect(choices.every((choice) => choice.length <= 2_000 && content.includes(choice))).toBe(true);
    expect(choices.some((choice) => choice.startsWith("처음"))).toBe(true);
    expect(choices.some((choice) => choice.endsWith("마지막"))).toBe(true);
  });
});
