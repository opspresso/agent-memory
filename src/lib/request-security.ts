const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const bearerPattern = /^Bearer\s+\S+$/i;

export function authenticationHeaders(request: Request): Headers {
  if (!bearerPattern.test(request.headers.get("authorization") ?? "")) {
    return request.headers;
  }
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  return headers;
}

export function hasTrustedMutationOrigin(
  request: Request,
  baseURL: string
): boolean {
  if (safeMethods.has(request.method.toUpperCase())) {
    return true;
  }

  if (bearerPattern.test(request.headers.get("authorization") ?? "")) {
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
