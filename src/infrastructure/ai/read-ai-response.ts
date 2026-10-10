import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

// Bound decoded response bytes before JSON parsing; schema validation happens afterward.
export const maximumAiResponseBytes = 32 * 1_024 * 1_024;

export async function readAiJsonResponse(response: Response, maximumBytes = maximumAiResponseBytes): Promise<unknown> {
  const limitError = () => new SafeOperationalError("AI provider response exceeds the byte limit", { code: "AI_RESPONSE_TOO_LARGE" });
  const invalidError = () => new SafeOperationalError("AI provider response is not valid JSON", { code: "AI_RESPONSE_INVALID" });
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("AI response byte limit must be a positive integer");
  if (Number(response.headers.get("content-length")) > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw limitError();
  }
  if (!response.body) throw invalidError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw limitError();
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof SafeOperationalError && error.code === "AI_RESPONSE_TOO_LARGE") throw error;
    // JSON and stream errors may contain source excerpts or provider details.
    throw invalidError();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
