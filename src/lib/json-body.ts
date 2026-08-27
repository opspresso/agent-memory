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

function oversizedJsonResponse(): JsonBodyResult {
  return {
    valid: false,
    response: Response.json(
      { error: "JSON body exceeds 1 MiB" },
      { status: 413 }
    )
  };
}

export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumJsonBodyBytes
  ) {
    return oversizedJsonResponse();
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
      if (bytesRead > maximumJsonBodyBytes) {
        await reader.cancel();
        return oversizedJsonResponse();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { valid: true, value: JSON.parse(text) as unknown };
  } catch {
    return invalidJsonResponse();
  }
}
