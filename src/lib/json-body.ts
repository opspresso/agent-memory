export const maximumJsonBodyBytes = 1_048_576;

type JsonBodyResult =
  | Readonly<{ valid: true; value: unknown }>
  | Readonly<{ valid: false; response: Response }>;

function invalidJsonResponse(): JsonBodyResult {
  return {
    valid: false,
    response: Response.json({ error: "Invalid JSON body" }, { status: 400 })
  };
}

function oversizedJsonResponse(maximumBytes: number): JsonBodyResult {
  return {
    valid: false,
    response: Response.json(
      { error: maximumBytes === maximumJsonBodyBytes ? "JSON body exceeds 1 MiB" : `JSON body exceeds ${maximumBytes} bytes` },
      { status: 413 }
    )
  };
}

export async function readJsonBody(request: Request, maximumBytes = maximumJsonBodyBytes): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    await request.body?.cancel().catch(() => {});
    return oversizedJsonResponse(maximumBytes);
  }
  if (!request.body) {
    return invalidJsonResponse();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        return oversizedJsonResponse(maximumBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { valid: true, value: JSON.parse(text) as unknown };
  } catch {
    return invalidJsonResponse();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
