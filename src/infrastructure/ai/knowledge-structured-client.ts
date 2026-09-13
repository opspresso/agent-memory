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

export function createKnowledgeStructuredClient(configuration: KnowledgeStructuredClientConfiguration) {
  const baseUrl = configuration.baseUrl.trim().replace(/\/+$/, "");
  const model = configuration.model.trim();
  if (!baseUrl || !model) throw new Error("knowledge extraction base URL and model must not be empty");
  const endpoint = new URL(`${baseUrl}/chat/completions`).toString();
  const request = configuration.request ?? fetch;
  async function generate(system: string, user: unknown, schema: Readonly<Record<string,unknown>>): Promise<unknown> {
    const response = await request(endpoint,{
      method:"POST",headers:{ "Content-Type":"application/json",...(configuration.apiKey?.trim()?{ Authorization:`Bearer ${configuration.apiKey.trim()}` }:{}) },
      signal:AbortSignal.timeout(knowledgeRequestTimeoutMilliseconds),
      body:JSON.stringify({ model,temperature:0,messages:[{ role:"system",content:system },{ role:"user",content:JSON.stringify(user) }],
        response_format:{ type:"json_schema",json_schema:schema } })
    });
    if (!response.ok) throw new SafeOperationalError(`knowledge extraction request failed with status ${response.status}`,{ code:"KNOWLEDGE_EXTRACTION_HTTP_ERROR" });
    const parsed = completionSchema.safeParse(await response.json());
    if (!parsed.success) throw new SafeOperationalError("knowledge extraction response is invalid",{ code:"KNOWLEDGE_EXTRACTION_RESPONSE_INVALID" });
    try { return JSON.parse(parsed.data.choices[0]!.message.content) as unknown; }
    catch { throw new SafeOperationalError("knowledge extraction response content is not JSON",{ code:"KNOWLEDGE_EXTRACTION_RESPONSE_NOT_JSON" }); }
  }
  return {
    generate(system: string,user: unknown,schema: Readonly<Record<string,unknown>>,quotaKey?: AiRequestQuotaKey) {
      return configuration.requestLimiter
        ? configuration.requestLimiter.run(() => generate(system,user,schema),quotaKey)
        : generate(system,user,schema);
    }
  };
}
