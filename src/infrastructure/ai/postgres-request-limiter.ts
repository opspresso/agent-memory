import { lt, sql } from "drizzle-orm";

import {
  AiRequestLimitExceededError,
  type AiRequestLimiter,
  type AiRequestQuotaKey
} from "@/domain/shared/ai-request-limiter";
import type { AgentMemoryDatabase } from "@/infrastructure/database/client";
import { aiRequestBuckets } from "@/infrastructure/database/schema";

const windowMilliseconds = 60_000;

export interface DurableAiRequestLimits {
  readonly maximumOrganizationRequestsPerMinute: number;
  readonly maximumUserRequestsPerMinute: number;
}

interface PostgresAiRequestLimiterOptions extends DurableAiRequestLimits {
  readonly clock?: () => number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function readDurableAiRequestLimits(
  environment: Readonly<Record<string, string | undefined>> = process.env
): DurableAiRequestLimits {
  const configured = (name: string, fallback: number) => {
    const raw = environment[name]?.trim();
    return positiveInteger(raw ? Number(raw) : fallback, name);
  };
  return {
    maximumOrganizationRequestsPerMinute: configured(
      "AI_ORGANIZATION_REQUESTS_PER_MINUTE",
      120
    ),
    maximumUserRequestsPerMinute: configured(
      "AI_USER_REQUESTS_PER_MINUTE",
      30
    )
  };
}

async function incrementBucket(
  transaction: Parameters<
    Parameters<AgentMemoryDatabase["transaction"]>[0]
  >[0],
  quotaKey: AiRequestQuotaKey,
  principalKey: string,
  windowStartedAt: Date,
  maximumRequests: number
): Promise<boolean> {
  const [consumed] = await transaction
    .insert(aiRequestBuckets)
    .values({
      organizationId: quotaKey.organizationId,
      principalKey,
      windowStartedAt,
      requestCount: 1
    })
    .onConflictDoUpdate({
      target: [
        aiRequestBuckets.organizationId,
        aiRequestBuckets.principalKey,
        aiRequestBuckets.windowStartedAt
      ],
      set: { requestCount: sql`${aiRequestBuckets.requestCount} + 1` },
      setWhere: lt(aiRequestBuckets.requestCount, maximumRequests)
    })
    .returning({ requestCount: aiRequestBuckets.requestCount });
  return consumed !== undefined;
}

export function createPostgresAiRequestLimiter(
  db: AgentMemoryDatabase,
  options: PostgresAiRequestLimiterOptions
): AiRequestLimiter {
  const organizationLimit = positiveInteger(
    options.maximumOrganizationRequestsPerMinute,
    "AI organization requests per minute"
  );
  const userLimit = positiveInteger(
    options.maximumUserRequestsPerMinute,
    "AI user requests per minute"
  );
  const clock = options.clock ?? Date.now;

  return {
    async run<T>(
      operation: () => Promise<T>,
      quotaKey?: AiRequestQuotaKey
    ): Promise<T> {
      if (!quotaKey) {
        throw new Error("AI request quota key is required");
      }
      const now = clock();
      const windowStartedAt = new Date(
        Math.floor(now / windowMilliseconds) * windowMilliseconds
      );
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (windowStartedAt.getTime() + windowMilliseconds - now) / 1_000
        )
      );
      await db.transaction(async (transaction) => {
        const organizationConsumed = await incrementBucket(
          transaction,
          quotaKey,
          "organization",
          windowStartedAt,
          organizationLimit
        );
        if (!organizationConsumed) {
          throw new AiRequestLimitExceededError(retryAfterSeconds);
        }
        const userConsumed = await incrementBucket(
          transaction,
          quotaKey,
          `user:${quotaKey.userId}`,
          windowStartedAt,
          userLimit
        );
        if (!userConsumed) {
          throw new AiRequestLimitExceededError(retryAfterSeconds);
        }
        await transaction
          .delete(aiRequestBuckets)
          .where(
            lt(
              aiRequestBuckets.windowStartedAt,
              new Date(windowStartedAt.getTime() - 86_400_000)
            )
          );
      });
      return operation();
    }
  };
}
