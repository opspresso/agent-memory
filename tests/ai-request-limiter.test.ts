import { describe, expect, it, vi } from "vitest";

import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";
import { createKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-extraction-service";
import {
  createAiRequestLimiter,
  readAiRequestLimits
} from "@/infrastructure/ai/request-limiter";
import { readDurableAiRequestLimits } from "@/infrastructure/ai/postgres-request-limiter";
import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";
import { aiErrorResponse } from "@/lib/ai-http";

describe("AI provider request limiter", () => {
  it("applies default and validated environment limits", () => {
    expect(readAiRequestLimits({})).toEqual({
      maxConcurrent: 8,
      maxRequestsPerMinute: 120
    });
    expect(
      readAiRequestLimits({
        AI_PROVIDER_MAX_CONCURRENCY: "3",
        AI_PROVIDER_REQUESTS_PER_MINUTE: "45"
      })
    ).toEqual({ maxConcurrent: 3, maxRequestsPerMinute: 45 });
    expect(() =>
      readAiRequestLimits({ AI_PROVIDER_MAX_CONCURRENCY: "0" })
    ).toThrow("AI_PROVIDER_MAX_CONCURRENCY must be a positive integer");
    expect(readDurableAiRequestLimits({})).toEqual({
      maximumOrganizationRequestsPerMinute: 120,
      maximumUserRequestsPerMinute: 30
    });
    expect(
      readDurableAiRequestLimits({
        AI_ORGANIZATION_REQUESTS_PER_MINUTE: "20",
        AI_USER_REQUESTS_PER_MINUTE: "5"
      })
    ).toEqual({
      maximumOrganizationRequestsPerMinute: 20,
      maximumUserRequestsPerMinute: 5
    });
  });

  it("rejects excess requests until the fixed window resets", async () => {
    let now = 0;
    const limiter = createAiRequestLimiter({
      clock: () => now,
      maxConcurrent: 2,
      maxRequestsPerMinute: 2
    });

    await limiter.run(async () => "first");
    await limiter.run(async () => "second");
    await expect(limiter.run(async () => "third")).rejects.toMatchObject({
      retryAfterSeconds: 60
    });
    now = 60_000;
    await expect(limiter.run(async () => "next window")).resolves.toBe(
      "next window"
    );
  });

  it("rejects excess concurrency without consuming the minute budget", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const limiter = createAiRequestLimiter({
      maxConcurrent: 1,
      maxRequestsPerMinute: 2
    });
    const first = limiter.run(() => pending);

    await expect(limiter.run(async () => undefined)).rejects.toMatchObject({
      retryAfterSeconds: 1
    });
    release?.();
    await first;
    await expect(limiter.run(async () => "second")).resolves.toBe("second");
  });

  it("shares one budget across embedding and extraction providers", async () => {
    const limiter = createAiRequestLimiter({
      maxConcurrent: 2,
      maxRequestsPerMinute: 1
    });
    const embeddingRequest = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ embedding: [1], index: 0 }] })
    );
    const extractionRequest = vi.fn<typeof fetch>();
    const embedding = createTextEmbeddingService({
      baseUrl: "https://provider.example/v1",
      model: "embedding-model",
      request: embeddingRequest,
      requestLimiter: limiter
    });
    const extraction = createKnowledgeExtractionService({
      baseUrl: "https://provider.example/v1",
      model: "extraction-model",
      request: extractionRequest,
      requestLimiter: limiter
    });

    await embedding.embed("query");
    await expect(
      extraction.extract({
        documentTitle: "Runbook",
        mimeType: "text/plain",
        content: "content"
      })
    ).rejects.toBeInstanceOf(AiRequestLimitExceededError);
    expect(extractionRequest).not.toHaveBeenCalled();
  });

  it("maps provider limits to a retryable HTTP response", async () => {
    const response = aiErrorResponse(new AiRequestLimitExceededError(12));

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("12");
    await expect(response?.json()).resolves.toEqual({
      error: "AI provider request limit exceeded"
    });
  });
});
