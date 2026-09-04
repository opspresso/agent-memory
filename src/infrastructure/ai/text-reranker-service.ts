import { z } from "zod";

import type { AiRequestLimiter } from "@/domain/shared/ai-request-limiter";
import {
  TextRerankerUnavailableError,
  type TextRerankerService
} from "@/domain/shared/text-reranker-service";

interface TextRerankerServiceConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly requestLimiter?: AiRequestLimiter;
  readonly request?: typeof fetch;
  readonly timeoutMilliseconds?: number;
}

const rerankResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      relevance_score: z.number().finite()
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

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function createTextRerankerService(
  configuration: TextRerankerServiceConfiguration
): TextRerankerService {
  const baseUrl = requiredSetting(
    configuration.baseUrl,
    "reranker base URL"
  ).replace(/\/+$/, "");
  const endpoint = new URL(`${baseUrl}/rerank`).toString();
  const model = requiredSetting(configuration.model, "reranker model");
  const apiKey = configuration.apiKey?.trim();
  const request = configuration.request ?? fetch;
  const timeoutMilliseconds = positiveInteger(
    configuration.timeoutMilliseconds ?? 5_000,
    "reranker timeout"
  );

  async function requestRerank(
    input: Parameters<TextRerankerService["rerank"]>[0]
  ): Promise<readonly number[]> {
    const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeoutSignal])
      : timeoutSignal;
    const response = await request(endpoint, {
      body: JSON.stringify({
        documents: [...input.documents],
        model,
        query: input.query,
        top_n: input.documents.length
      }),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      method: "POST",
      signal
    });
    if (!response.ok) {
      throw new Error(`reranker request failed with status ${response.status}`);
    }

    const parsed = rerankResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.results.length !== input.documents.length) {
      throw new Error("reranker response count does not match inputs");
    }
    const scores: Array<number | undefined> = new Array(input.documents.length);
    for (const result of parsed.data.results) {
      if (
        result.index >= input.documents.length ||
        scores[result.index] !== undefined
      ) {
        throw new Error("reranker response contains an invalid index");
      }
      scores[result.index] = result.relevance_score;
    }
    if (scores.some((score) => score === undefined)) {
      throw new Error("reranker response does not cover every input");
    }
    return scores as number[];
  }

  return {
    async rerank(input) {
      if (input.documents.length === 0) {
        return [];
      }
      try {
        return await (configuration.requestLimiter
          ? configuration.requestLimiter.run(() => requestRerank(input))
          : requestRerank(input));
      } catch (error) {
        input.signal?.throwIfAborted();
        throw new TextRerankerUnavailableError(
          "text reranker is unavailable",
          { cause: error }
        );
      }
    }
  };
}
