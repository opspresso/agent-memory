import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";

export function aiErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AiRequestLimitExceededError)) {
    return null;
  }
  return Response.json(
    { error: error.message },
    {
      status: 429,
      headers: { "Retry-After": String(error.retryAfterSeconds) }
    }
  );
}
