import {
  AiRequestLimitExceededError,
  type AiRequestLimiter
} from "@/domain/shared/ai-request-limiter";

const windowMilliseconds = 60_000;

export interface AiRequestLimits {
  readonly maxConcurrent: number;
  readonly maxRequestsPerMinute: number;
}

interface AiRequestLimiterOptions extends AiRequestLimits {
  readonly clock?: () => number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function readAiRequestLimits(
  environment: Readonly<Record<string, string | undefined>> = process.env
): AiRequestLimits {
  const configured = (name: string, fallback: number) => {
    const raw = environment[name]?.trim();
    return positiveInteger(raw ? Number(raw) : fallback, name);
  };
  return {
    maxConcurrent: configured("AI_PROVIDER_MAX_CONCURRENCY", 8),
    maxRequestsPerMinute: configured("AI_PROVIDER_REQUESTS_PER_MINUTE", 120)
  };
}

export function createAiRequestLimiter(
  options: AiRequestLimiterOptions
): AiRequestLimiter {
  const maxConcurrent = positiveInteger(
    options.maxConcurrent,
    "AI provider maximum concurrency"
  );
  const maxRequestsPerMinute = positiveInteger(
    options.maxRequestsPerMinute,
    "AI provider requests per minute"
  );
  const clock = options.clock ?? Date.now;
  let active = 0;
  let requests = 0;
  let windowStartedAt = clock();

  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const now = clock();
      if (now - windowStartedAt >= windowMilliseconds) {
        windowStartedAt = now;
        requests = 0;
      }
      if (active >= maxConcurrent) {
        throw new AiRequestLimitExceededError(1);
      }
      if (requests >= maxRequestsPerMinute) {
        throw new AiRequestLimitExceededError(
          Math.max(
            1,
            Math.ceil(
              (windowStartedAt + windowMilliseconds - now) / 1_000
            )
          )
        );
      }

      active += 1;
      requests += 1;
      try {
        return await operation();
      } finally {
        active -= 1;
      }
    }
  };
}
