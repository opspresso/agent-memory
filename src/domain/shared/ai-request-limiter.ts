export interface AiRequestLimiter {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export class AiRequestLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("AI provider request limit exceeded");
    this.name = "AiRequestLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
