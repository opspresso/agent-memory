import { z } from "zod";

import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import type { AiRequestLimiter } from "@/domain/shared/ai-request-limiter";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

interface TextEmbeddingServiceConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly requestLimiter?: AiRequestLimiter;
  readonly request?: typeof fetch;
}

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()).min(1),
      index: z.number().int().nonnegative()
    })
  )
});

function requiredSetting(value: string, name: string): string {
  const setting = value.trim();
  if (setting.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return setting;
}

export function createTextEmbeddingService(
  configuration: TextEmbeddingServiceConfiguration
): TextEmbeddingService {
  const baseUrl = requiredSetting(
    configuration.baseUrl,
    "embedding base URL"
  ).replace(/\/+$/, "");
  const endpoint = new URL(`${baseUrl}/embeddings`).toString();
  const model = requiredSetting(configuration.model, "embedding model");
  const apiKey = configuration.apiKey?.trim();
  const request = configuration.request ?? fetch;

  async function requestEmbeddings(texts: readonly string[]) {
    const response = await request(endpoint, {
      body: JSON.stringify({ input: [...texts], model }),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      method: "POST",
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      throw new SafeOperationalError(
        `embedding request failed with status ${response.status}`,
        { code: "EMBEDDING_HTTP_ERROR" }
      );
    }

    const parsed = embeddingResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new SafeOperationalError("embedding response is invalid", {
        code: "EMBEDDING_RESPONSE_INVALID"
      });
    }
    const ordered = parsed.data.data.toSorted((left, right) =>
      left.index - right.index
    );
    if (
      ordered.length !== texts.length ||
      ordered.some((item, index) => item.index !== index)
    ) {
      throw new SafeOperationalError(
        "embedding response count does not match inputs",
        { code: "EMBEDDING_RESPONSE_COUNT_MISMATCH" }
      );
    }
    return ordered.map(({ embedding }) => ({ model, values: embedding }));
  }

  function embedTexts(texts: readonly string[]) {
    return configuration.requestLimiter
      ? configuration.requestLimiter.run(() => requestEmbeddings(texts))
      : requestEmbeddings(texts);
  }

  return {
    async embed(text) {
      const [embedding] = await embedTexts([text]);
      if (!embedding) {
        throw new SafeOperationalError("embedding response is empty", {
          code: "EMBEDDING_RESPONSE_EMPTY"
        });
      }
      return embedding;
    },
    async embedMany(texts) {
      return texts.length === 0 ? [] : embedTexts(texts);
    }
  };
}
