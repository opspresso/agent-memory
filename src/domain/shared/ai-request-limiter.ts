export interface AiRequestQuotaKey {
  readonly organizationId: string;
  readonly userId: string;
}

export interface AiRequestLimiter {
  run<T>(
    operation: () => Promise<T>,
    quotaKey?: AiRequestQuotaKey
  ): Promise<T>;
}

export class AiRequestLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("AI provider request limit exceeded");
    this.name = "AiRequestLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
