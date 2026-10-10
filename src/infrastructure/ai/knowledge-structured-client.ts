import { readAiJsonResponse } from "./read-ai-response";
import { z } from "zod";
import type { AiRequestLimiter, AiRequestQuotaKey } from "@/domain/shared/ai-request-limiter";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import { knowledgeRequestTimeoutMilliseconds } from "./knowledge-request-timeout";

export interface KnowledgeStructuredClientConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly requestLimiter?: AiRequestLimiter;
  readonly request?: typeof fetch;
}

const completionSchema = z.object({ choices:z.array(z.object({ message:z.object({ content:z.string() }) })).min(1) });

export function createKnowledgeStructuredClient(configuration: KnowledgeStructuredClientConfiguration, operation: "extraction" | "verification" | "ontology" = "extraction") {
  const label = operation === "ontology" ? "knowledge ontology suggestion" : `knowledge ${operation}`;
  const code = `KNOWLEDGE_${operation.toUpperCase()}`;
  const baseUrl = configuration.baseUrl.trim().replace(/\/+$/, "");
  const model = configuration.model.trim();
  if (!baseUrl || !model) throw new Error(`${label} base URL and model must not be empty`);
  const endpoint = new URL(`${baseUrl}/chat/completions`).toString();
  const request = configuration.request ?? fetch;
  const apiKey = configuration.apiKey?.trim();
  async function generate(system: string, user: unknown, schema: Readonly<Record<string,unknown>>): Promise<unknown> {
    const response = await request(endpoint,{
      method:"POST",headers:{ "Content-Type":"application/json",...(apiKey?{ Authorization:`Bearer ${apiKey}` }:{}) },
      signal:AbortSignal.timeout(operation === "ontology" ? 60_000 : knowledgeRequestTimeoutMilliseconds),
      body:JSON.stringify({ model,temperature:0,messages:[{ role:"system",content:system },{ role:"user",content:JSON.stringify(user) }],
        response_format:{ type:"json_schema",json_schema:schema } })
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SafeOperationalError(`${label} request failed with status ${response.status}`,{ code:`${code}_HTTP_ERROR` });
    }
    const parsed = completionSchema.safeParse(await readAiJsonResponse(response, operation === "ontology" ? 128 * 1_024 : undefined));
    if (!parsed.success) throw new SafeOperationalError(`${label} response is invalid`,{ code:`${code}_RESPONSE_INVALID` });
    try { return JSON.parse(parsed.data.choices[0]!.message.content) as unknown; }
    catch { throw new SafeOperationalError(`${label} response content is not JSON`,{ code:`${code}_RESPONSE_NOT_JSON` }); }
  }
  return {
    generate(system: string,user: unknown,schema: Readonly<Record<string,unknown>>,quotaKey?: AiRequestQuotaKey) {
      return configuration.requestLimiter
        ? configuration.requestLimiter.run(() => generate(system,user,schema),quotaKey)
        : generate(system,user,schema);
    }
  };
}
