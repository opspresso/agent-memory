import { readAiJsonResponse } from "./read-ai-response";
import { z } from "zod";

import { maximumEmbeddingDimensions, type TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import type {
  AiRequestLimiter,
  AiRequestQuotaKey
} from "@/domain/shared/ai-request-limiter";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

interface TextEmbeddingServiceConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly dimensions?: number;
  readonly requestLimiter?: AiRequestLimiter;
  readonly request?: typeof fetch;
}

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()).min(1).max(maximumEmbeddingDimensions)
        .refine((values) => values.every((value) => Number.isFinite(Math.fround(value))) &&
          values.some((value) => Math.fround(value) !== 0), "embedding must contain finite nonzero float32 values"),
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
  const dimensions = configuration.dimensions;
  if (dimensions !== undefined && (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > maximumEmbeddingDimensions)) {
    throw new Error(`embedding dimensions must be an integer between 1 and ${maximumEmbeddingDimensions}`);
  }

  async function requestEmbeddings(texts: readonly string[]) {
    const response = await request(endpoint, {
      body: JSON.stringify({
        input: [...texts], model, encoding_format: "float",
        ...(dimensions !== undefined ? { dimensions } : {})
      }),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      method: "POST",
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SafeOperationalError(
        `embedding request failed with status ${response.status}`,
        { code: "EMBEDDING_HTTP_ERROR" }
      );
    }

    // Budget 32 bytes per returned float, plus separate envelope metadata.
    const parsed = embeddingResponseSchema.safeParse(await readAiJsonResponse(response, 64 * 1_024 + texts.length * (dimensions ?? maximumEmbeddingDimensions) * 32));
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
    const expectedDimensions = dimensions ?? ordered[0]?.embedding.length;
    if (ordered.some(({ embedding }) => embedding.length !== expectedDimensions)) {
      throw new SafeOperationalError("embedding response dimensions do not match", {
        code: "EMBEDDING_RESPONSE_DIMENSION_MISMATCH"
      });
    }
    return ordered.map(({ embedding }) => ({ model, values: embedding }));
  }

  function embedTexts(
    texts: readonly string[],
    quotaKey?: AiRequestQuotaKey
  ) {
    return configuration.requestLimiter
      ? configuration.requestLimiter.run(
          () => requestEmbeddings(texts),
          quotaKey
        )
      : requestEmbeddings(texts);
  }

  return {
    async embed(text, quotaKey) {
      const [embedding] = await embedTexts([text], quotaKey);
      if (!embedding) {
        throw new SafeOperationalError("embedding response is empty", {
          code: "EMBEDDING_RESPONSE_EMPTY"
        });
      }
      return embedding;
    },
    async embedMany(texts, quotaKey) {
      return texts.length === 0 ? [] : embedTexts(texts, quotaKey);
    }
  };
}
