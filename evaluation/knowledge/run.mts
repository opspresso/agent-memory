import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createKnowledgeExtractionService } from "../../src/infrastructure/ai/knowledge-extraction-service";
import { createEntityFirstKnowledgeExtractionService } from "../../src/infrastructure/ai/knowledge-entity-first-extraction-service";
import { createKnowledgeVerificationService } from "../../src/infrastructure/ai/knowledge-verification-service";
import { readKnowledgeVerificationConfiguration } from "../../src/lib/knowledge-verification-configuration";
import { groundKnowledgeGraph } from "../../src/domain/knowledge/knowledge-extraction-quality";
import { createKnowledgeCandidate } from "../../src/domain/knowledge/knowledge-candidate";
import { assessKnowledgeCandidate } from "../../src/domain/knowledge/knowledge-curation-policy";
import { selectKnowledgeCandidateItems } from "../../src/domain/knowledge/knowledge-candidate-selection";
import { extractionMetrics, scoreKnowledgeExtraction, type ExtractionCounts } from "../../src/domain/knowledge/knowledge-extraction-evaluation";

const { values } = parseArgs({ options: {
  variants: { type:"string",default:"single-pass,llamaindex,entity-first" },
  python: { type:"string",default:"python3" },
  output: { type:"string",default:".eval-results/knowledge" },
  limit: { type:"string" },
  verify: { type:"boolean",default:false },
  reuse: { type:"string" }
} });
const corpusSchema = z.object({ schemaVersion:z.literal(1), nodeKinds:z.array(z.string()),
  patterns:z.array(z.object({ sourceKind:z.string(),predicate:z.string(),targetKind:z.string() })),
  cases:z.array(z.object({ id:z.string(),content:z.string(),entities:z.array(z.object({ kind:z.string(),name:z.string() })),
    relationships:z.array(z.object({ source:z.string(),predicate:z.string(),target:z.string() })),
    aliases:z.record(z.string(),z.array(z.string())).optional(),surfaceForms:z.record(z.string(),z.array(z.string())).optional() })) });
const graphSchema = z.object({ entities:z.array(z.object({ key:z.string(),kind:z.string(),canonicalName:z.string(),
  summary:z.string().nullable().optional().transform((value) => value ?? undefined), aliases:z.array(z.string()).optional(), evidence:z.array(z.string()).optional() })),
  relationships:z.array(z.object({ sourceKey:z.string(),targetKey:z.string(),predicate:z.string(),evidence:z.array(z.string()).optional() })) });
const rowSchema = z.object({ id:z.string(),status:z.enum(["ok","error"]),error:z.string().optional(),errorLocation:z.string().optional(),milliseconds:z.number(),graph:graphSchema });
type ExtractionRow = z.infer<typeof rowSchema>;

const corpusText = await readFile(new URL("./corpus.json",import.meta.url),"utf8");
const corpus = corpusSchema.parse(JSON.parse(corpusText));
const limit = values.limit === undefined ? corpus.cases.length : Number(values.limit);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > corpus.cases.length) throw new Error("limit must select a positive number of corpus cases");
const cases = corpus.cases.slice(0,limit);
const variants = values.variants.split(",");
if (variants.some((variant) => !["single-pass","llamaindex","entity-first"].includes(variant))) throw new Error("unknown evaluation variant");
const model = process.env.KNOWLEDGE_EXTRACTION_MODEL?.trim();
const baseUrl = process.env.KNOWLEDGE_EXTRACTION_BASE_URL?.trim();
if (!model || !baseUrl) throw new Error("knowledge extraction model and base URL are required");
const configuration = { model,baseUrl,apiKey:process.env.KNOWLEDGE_EXTRACTION_API_KEY,language:"ko" as const };
const verificationConfiguration = values.verify ? readKnowledgeVerificationConfiguration() : undefined;
const ontology = { nodeKinds:corpus.nodeKinds,edgePredicates:[...new Set(corpus.patterns.map((pattern) => pattern.predicate))] };
const directory = resolve(values.output);
await mkdir(directory,{ recursive:true });
const policyHash = createHash("sha256");
for (const path of ["src/infrastructure/ai/knowledge-extraction-service.ts","src/infrastructure/ai/knowledge-entity-first-extraction-service.ts","src/domain/knowledge/knowledge-extraction-quality.ts",
  "src/domain/knowledge/knowledge-entity-eligibility.ts","src/infrastructure/ai/knowledge-verification-service.ts","src/domain/knowledge/knowledge-curation-policy.ts"]) {
  policyHash.update(await readFile(path));
}

async function pythonRows(): Promise<ExtractionRow[]> {
  const pythonEnvironment = { NODE_ENV:process.env.NODE_ENV, ...Object.fromEntries(["PATH","HOME","TMPDIR","LANG","SSL_CERT_FILE","SSL_CERT_DIR","HTTP_PROXY","HTTPS_PROXY","NO_PROXY",
    "KNOWLEDGE_EXTRACTION_MODEL","KNOWLEDGE_EXTRACTION_BASE_URL","KNOWLEDGE_EXTRACTION_API_KEY"]
    .flatMap((name) => process.env[name] === undefined ? [] : [[name,process.env[name]]])) };
  const child = spawn(values.python,[resolve("evaluation/knowledge/llamaindex.py")],{ stdio:["pipe","pipe","pipe"],env:pythonEnvironment });
  let buffer = "";
  const rows: ExtractionRow[] = [];
  // Never relay a dependency's stderr: validation errors can contain source text.
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  const done = new Promise<void>((accept,reject) => {
    child.once("error",reject);
    child.once("close",(code) => code === 0 ? accept() : reject(new Error(`Python comparison exited with status ${code}`)));
  });
  child.stdin.end(JSON.stringify({ ...corpus,cases }));
  for await (const chunk of child.stdout) {
    buffer += String(chunk);
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
      if (!line.trim()) continue;
      const row = rowSchema.parse(JSON.parse(line));
      rows.push(row);
      process.stdout.write(`llamaindex ${row.id}: ${row.status}\n`);
    }
  }
  await done;
  if (buffer.trim() || rows.length !== cases.length || cases.some((item,index) => item.id !== rows[index]?.id)) {
    throw new Error("Python comparison did not cover the corpus exactly once");
  }
  return rows;
}

async function currentRows(variant: string): Promise<ExtractionRow[]> {
  const service = variant === "entity-first" ? createEntityFirstKnowledgeExtractionService(configuration) : createKnowledgeExtractionService(configuration);
  const rows: ExtractionRow[] = [];
  for (const item of cases) {
    const started = performance.now();
    try {
      const result = await service.extract({ content:item.content,documentTitle:"Synthetic evaluation source",mimeType:item.id.startsWith("json")?"application/json":item.id.startsWith("markdown")?"text/markdown":"text/plain",
        ontology:{ ...ontology,mode:"strict" } });
      rows.push({ id:item.id,status:"ok",graph:graphSchema.parse(result.graph),milliseconds:Math.round(performance.now()-started) });
    } catch (error) {
      rows.push({ id:item.id,status:"error",error:error instanceof Error?error.name:"UnknownError",graph:{ entities:[],relationships:[] },milliseconds:Math.round(performance.now()-started) });
    }
    process.stdout.write(`${variant} ${item.id}: ${rows.at(-1)!.status}\n`);
  }
  return rows;
}

function aggregate(scores: readonly ReturnType<typeof scoreKnowledgeExtraction>[], key:"entities"|"relationships"|"aliases") {
  const total = scores.reduce<ExtractionCounts>((sum,score) => ({
    truePositive:sum.truePositive+score[key].truePositive,falsePositive:sum.falsePositive+score[key].falsePositive,falseNegative:sum.falseNegative+score[key].falseNegative
  }),{ truePositive:0,falsePositive:0,falseNegative:0 });
  return extractionMetrics(total);
}

const summaries = [];
for (const variant of variants) {
  let rows: ExtractionRow[];
  if (values.reuse) {
    const original = JSON.parse(await readFile(resolve(values.reuse,"summary.json"),"utf8")) as { corpusSha256:string;model:string };
    if (original.model !== model || original.corpusSha256 !== createHash("sha256").update(corpusText).digest("hex")) {
      throw new Error("reused extraction must match the model and corpus");
    }
    rows = z.array(rowSchema).parse(JSON.parse(await readFile(resolve(values.reuse,`${variant}.json`),"utf8"))).slice(0,limit);
    if (rows.length !== cases.length || rows.some((row,index) => row.id !== cases[index]!.id)) throw new Error("reused extraction must cover selected cases in order");
  } else {
    rows = variant === "llamaindex" ? await pythonRows() : await currentRows(variant);
  }
  const scored = [];
  const verification = createKnowledgeVerificationService(verificationConfiguration??configuration);
  for (const [index,row] of rows.entries()) {
    const item = cases[index]!;
    let graph = groundKnowledgeGraph(item.content,row.graph);
    const candidateScore = scoreKnowledgeExtraction(graph,item,true);
    let verificationError: string | undefined;
    if (values.verify && row.status === "ok") {
      try {
        const candidate = createKnowledgeCandidate({ id:item.id,documentId:"evaluation",chunkId:item.id,scope:{ organizationId:"evaluation",kind:"organization" },model,graph,now:new Date() });
        const result = await verification.verify({ content:item.content,documentTitle:"Synthetic evaluation source",graph,existingKnowledge:[],quotaKey:{ organizationId:"evaluation",userId:"evaluation" } });
        const assessment = assessKnowledgeCandidate({ candidate,content:item.content,...result,ontology:{ ontology,mode:"strict" },now:new Date() });
        const accepted = new Set(assessment.items.filter((item) => item.verdict === "accept").map((item) => item.item));
        const selection = { entityKeys:graph.entities.filter((entity) => accepted.has(`entity:${entity.key}`)).map((entity) => entity.key),
          relationshipIndexes:graph.relationships.flatMap((_,index) => accepted.has(`relationship:${index}`)?[index]:[]) };
        graph = selection.entityKeys.length + selection.relationshipIndexes.length ? selectKnowledgeCandidateItems(candidate,selection).graph : { entities:[],relationships:[] };
        graph = { ...graph,entities:graph.entities.map((entity) => ({ ...entity,aliases:assessment.aliases?.filter((alias) => alias.entityKey===entity.key && alias.verdict==="accept").map((alias) => alias.alias) ?? [] })) };
      } catch (error) {
        verificationError = error instanceof Error ? error.name : "UnknownError";
        graph = { entities:[],relationships:[] };
      }
      process.stdout.write(`verify ${variant} ${item.id}: ${verificationError??"ok"}\n`);
    }
    scored.push({ ...row,verificationError,rawScore:scoreKnowledgeExtraction(row.graph,item),candidateScore,
      canonicalScore:scoreKnowledgeExtraction(graph,item),score:scoreKnowledgeExtraction(graph,item,true),publishedGraph:graph });
  }
  await writeFile(resolve(directory,`${variant}.json`),JSON.stringify(scored,null,2)+"\n");
  const latency = rows.map((row) => row.milliseconds).sort((a,b) => a-b);
  const scores = scored.map((row) => row.score);
  summaries.push({ variant,cases:cases.length,errors:scored.filter((row) => row.status==="error" || row.verificationError).length,
    candidates:{ entities:aggregate(scored.map((row) => row.candidateScore),"entities"),relationships:aggregate(scored.map((row) => row.candidateScore),"relationships") },
    canonical:{ entities:aggregate(scored.map((row) => row.canonicalScore),"entities"),relationships:aggregate(scored.map((row) => row.canonicalScore),"relationships") },
    entities:aggregate(scores,"entities"),relationships:aggregate(scores,"relationships"),aliases:aggregate(scores,"aliases"),falseMerges:scores.reduce((sum,row) => sum+row.falseMerges,0),
    extractionLatencyMilliseconds:{ median:latency[Math.floor(latency.length/2)],p95:latency[Math.ceil(latency.length*.95)-1] },
    casesWithErrors:scored.filter((row) => row.status==="error" || row.verificationError).map((row) => ({ id:row.id,error:row.error??row.verificationError })) });
}
const report = { evaluatedAt:new Date().toISOString(),model,verified:values.verify,reusedExtractions:values.reuse!==undefined,
  verificationModel:verificationConfiguration?.model,
  matching:"Explicitly annotated source surface forms; canonical kind/name/edge matches are reported separately.",
  corpusSha256:createHash("sha256").update(corpusText).digest("hex"),policySha256:policyHash.digest("hex"),summaries };
await writeFile(resolve(directory,"summary.json"),JSON.stringify(report,null,2)+"\n");
process.stdout.write(JSON.stringify(report,null,2)+"\n");
if (summaries.some((summary) => summary.errors > 0)) process.exitCode = 1;
