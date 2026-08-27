export async function responseJson<T>(
  response: Response,
  fallback: string
): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { readonly error?: unknown })
    | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" && body.error.length > 0
        ? body.error
        : fallback
    );
  }
  if (body === null) {
    throw new Error(fallback);
  }
  return body;
}
