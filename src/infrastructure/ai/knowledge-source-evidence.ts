import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

/** Number exact source excerpts so models select references instead of rewriting evidence. */
export function sourceEvidencePassages(content: string) {
  const passages = [content];
  for (const line of content.split(/\r?\n+/)) {
    for (let start = 0; start < line.length; start += 1_800) {
      passages.push(line.slice(start, start + 2_000).trim());
      if (start + 2_000 >= line.length) break;
    }
  }
  return [...new Set(passages.filter((passage) => passage.length > 0 && passage.length <= 2_000))]
    .map((text, index) => ({ id:`s${index}`,text }));
}

export function resolveSourceEvidence(passages: readonly { readonly id:string; readonly text:string }[], id: string): string {
  const passage = passages.find((item) => item.id === id);
  if (!passage) throw new SafeOperationalError("unknown source evidence ID", { code:"KNOWLEDGE_EVIDENCE_ID_INVALID" });
  return passage.text;
}
