const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function hasTrustedMutationOrigin(
  request: Request,
  baseURL: string
): boolean {
  if (safeMethods.has(request.method.toUpperCase())) {
    return true;
  }

  if (/^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "")) {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = new URL(baseURL).origin;
    return origin === requestOrigin || origin === configuredOrigin;
  } catch {
    return false;
  }
}
