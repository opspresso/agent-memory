import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createKnowledgeVerificationService } from "../../src/infrastructure/ai/knowledge-verification-service";
import { createKnowledgeCandidate } from "../../src/domain/knowledge/knowledge-candidate";
import { assessKnowledgeCandidate } from "../../src/domain/knowledge/knowledge-curation-policy";
import { readKnowledgeVerificationConfiguration } from "../../src/lib/knowledge-verification-configuration";
import { createDecisionVerificationBenchmark, decisionResponseSchema } from "./decision-verification";

const options = parseArgs({ options: {
  variants: { type: "string", default: "chat,jev" },
  corpus: { type: "string", default: "evaluation/knowledge/verification-corpus.json" },
  output: { type: "string", default: ".eval-results/knowledge/verification" },
  repeats: { type: "string", default: "1" },
  threshold: { type: "string", default: "0" },
  split: { type: "string", default: "all" }
} }).values;
const entitySchema = z.object({ key: z.string().min(1), kind: z.string().min(1), canonicalName: z.string().min(1),
  summary: z.string().optional(), aliases: z.array(z.string()).optional() });
const corpusSchema = z.object({ schemaVersion: z.literal(1), cases: z.array(z.object({
  id: z.string().min(1), split: z.enum(["calibration", "validation"]), content: z.string().min(1),
  graph: z.object({ entities: z.array(entitySchema), relationships: z.array(z.object({
    sourceKey: z.string(), targetKey: z.string(), predicate: z.string()
  })) }), target: z.string(), expected: z.enum(["accept", "withhold"])
})).min(1) });
const usageSchema = z.object({ model: z.string().optional(), answers: decisionResponseSchema.shape.answers.optional(), usage: z.object({
  cost: z.number().nonnegative().optional(), input_tokens: z.number().optional(), prompt_tokens: z.number().optional(),
  output_tokens: z.number().optional(), completion_tokens: z.number().optional()
}).optional() });
const repeats = Number(options.repeats), threshold = Number(options.threshold);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("repeats must be between 1 and 10");
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("threshold must be between 0 and 1");
if (!["all", "calibration", "validation"].includes(options.split)) throw new Error("unknown split");
const variants = options.variants.split(",");
if (!variants.length || new Set(variants).size !== variants.length || variants.some((variant) => !["chat", "jev"].includes(variant))) throw new Error("unknown or duplicate variant");
const text = await readFile(options.corpus, "utf8");
let parsedCorpus: unknown;
try { parsedCorpus = JSON.parse(text); } catch { throw new Error("invalid verification corpus JSON"); }
const corpus = corpusSchema.safeParse(parsedCorpus);
if (!corpus.success) throw new Error("invalid verification corpus");
const cases = corpus.data.cases.filter((item) => options.split === "all" || item.split === options.split);
if (!cases.length || new Set(corpus.data.cases.map((item) => item.id)).size !== corpus.data.cases.length) throw new Error("empty selection or duplicate corpus ID");
for (const item of cases) {
  createKnowledgeCandidate({ id: item.id, documentId: "evaluation", chunkId: item.id,
    scope: { organizationId: "evaluation", kind: "organization" }, graph: item.graph, model: "synthetic", now: new Date(0) });
  const targets = [...item.graph.entities.map((entity) => `entity:${entity.key}`),
    ...item.graph.relationships.map((_, index) => `relationship:${index}`),
    ...item.graph.entities.flatMap((entity) => (entity.aliases ?? []).map((alias) => `alias:${entity.key}:${alias}`))];
  if (!targets.includes(item.target)) throw new Error(`invalid target for case ${item.id}`);
}
const chat = variants.includes("chat") ? readKnowledgeVerificationConfiguration() : undefined;
if (variants.includes("chat") && !chat) throw new Error("chat verification requires extraction or verification provider settings");
// Decisions always goes to OpenRouter, so never inherit a key from an arbitrary chat endpoint.
if (variants.includes("jev") && !process.env.OPENROUTER_API_KEY?.trim()) throw new Error("JEV evaluation requires OPENROUTER_API_KEY");
const directory = resolve(options.output);
await mkdir(directory, { recursive: true });
interface Row {
  id: string; split: string; repeat: number; expected: string; status: "ok" | "error";
  verdict?: string; milliseconds: number; costUsd?: number; requests: number; assessment?: unknown; error?: string;
  requestMetrics?: readonly (z.infer<typeof usageSchema> & { readonly status: number; readonly milliseconds: number })[];
}
function summarize(rows: readonly Row[], expectedCases: number) {
  const positive = rows.filter((row) => row.expected === "accept");
  const negative = rows.filter((row) => row.expected === "withhold");
  const accepted = positive.filter((row) => row.status === "ok" && row.verdict === "accept").length;
  const unsafe = negative.filter((row) => row.status === "ok" && row.verdict === "accept").length;
  const latency = rows.filter((row) => row.status === "ok").map((row) => row.milliseconds).sort((a, b) => a - b);
  return { expectedCases, completedCases: rows.length, errors: rows.filter((row) => row.status === "error").length,
    supported: positive.length, acceptedSupported: accepted, unsafeAccepted: unsafe, unsupported: negative.length,
    supportedRecall: positive.length ? accepted / positive.length : null,
    latencyMs: { median: latency[Math.floor(latency.length / 2)] ?? null, p95: latency[Math.ceil(latency.length * .95) - 1] ?? null },
    costUsd: rows.every((row) => row.costUsd !== undefined) ? rows.reduce((sum, row) => sum + row.costUsd!, 0) : null };
}
const summaries: unknown[] = [];
for (const variant of variants) {
  const rows: Row[] = [];
  let abortVariant = false;
  for (let repeat = 1; repeat <= repeats && !abortVariant; repeat++) {
    for (const item of cases) {
      const costs: (number | undefined)[] = [];
      const statuses: number[] = [];
      const requestMetrics: NonNullable<Row["requestMetrics"]>[number][] = [];
      const request: typeof fetch = async (...args) => {
        const started = performance.now();
        const response = await fetch(...args);
        statuses.push(response.status);
        let usage: z.infer<typeof usageSchema> | undefined;
        try { usage = usageSchema.parse(await response.clone().json()); } catch { /* Missing usage stays unknown, never zero. */ }
        costs.push(usage?.usage?.cost);
        requestMetrics.push({ status: response.status, milliseconds: Math.round(performance.now() - started), ...usage });
        return response;
      };
      const service = variant === "jev"
        ? createDecisionVerificationBenchmark({ apiKey: process.env.OPENROUTER_API_KEY, threshold, request })
        : createKnowledgeVerificationService({ ...chat!, request });
      const started = performance.now();
      try {
        const candidate = createKnowledgeCandidate({ id: item.id, documentId: "evaluation", chunkId: item.id,
          scope: { organizationId: "evaluation", kind: "organization" }, graph: item.graph, model: "synthetic", now: new Date() });
        const result = await service.verify({ content: item.content, documentTitle: "Synthetic verification diagnostic",
          graph: item.graph, existingKnowledge: [], quotaKey: { organizationId: "evaluation", userId: "evaluation" } });
        const assessment = assessKnowledgeCandidate({ candidate, content: item.content, ...result, ontology: null, now: new Date() });
        const target = item.target.startsWith("alias:")
          ? assessment.aliases?.find((alias) => `alias:${alias.entityKey}:${alias.alias}` === item.target)
          : assessment.items.find((entry) => entry.item === item.target);
        if (!target) throw new Error("target assessment is missing");
        rows.push({ id: item.id, split: item.split, repeat, expected: item.expected, status: "ok", verdict: target.verdict,
          milliseconds: Math.round(performance.now() - started), requests: statuses.length, assessment, requestMetrics,
          ...(costs.every((cost) => cost !== undefined) ? { costUsd: costs.reduce<number>((sum, cost) => sum + cost!, 0) } : {}) });
      } catch (error) {
        rows.push({ id: item.id, split: item.split, repeat, expected: item.expected, status: "error", requests: statuses.length,
          milliseconds: Math.round(performance.now() - started), requestMetrics, error: error instanceof Error ? error.name : "UnknownError" });
        if (statuses.some((status) => [401, 402, 403].includes(status))) abortVariant = true;
      }
      await writeFile(resolve(directory, `${variant}.json`), JSON.stringify(rows, null, 2) + "\n");
      process.stdout.write(`${variant} ${item.id} repeat ${repeat}: ${rows.at(-1)!.status}\n`);
      if (abortVariant) break;
    }
  }
  summaries.push({ variant, ...summarize(rows, cases.length * repeats), bySplit: Object.fromEntries(
    ["calibration", "validation"].map((split) => [split, summarize(rows.filter((row) => row.split === split), cases.filter((item) => item.split === split).length * repeats)])) });
  if (rows.length !== cases.length * repeats || rows.some((row) => row.status === "error")) process.exitCode = 1;
}
const sources = ["evaluation/knowledge/decision-verification.ts", "src/infrastructure/ai/knowledge-verification-service.ts",
  "src/infrastructure/ai/knowledge-source-instructions.ts", "src/infrastructure/ai/knowledge-source-evidence.ts",
  "src/domain/knowledge/knowledge-curation-policy.ts", "src/domain/knowledge/knowledge-assessment.ts",
  "src/domain/knowledge/knowledge-entity-eligibility.ts", "src/domain/knowledge/knowledge-identity.ts",
  "src/domain/knowledge/knowledge-candidate.ts", "evaluation/knowledge/verify.mts"];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const report = { evaluatedAt: new Date().toISOString(), corpusSha256: createHash("sha256").update(text).digest("hex"), sourceHashes,
  chatModel: chat?.model, decisionModel: "typesafe/jev-1.13", threshold, repeats, summaries,
  limitations: ["Authored diagnostics, not a blind production accuracy estimate.", "Evaluates supplied claims, not extraction recall.", "JEV adapter is evaluation-only and excludes existing-knowledge conflicts and custom kinds.", "Threshold zero measures raw decisions, not a safe production approval policy."] };
await writeFile(resolve(directory, "summary.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
