import { timingSafeEqual } from "node:crypto";

export function readMetricsToken(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | null {
  const token = environment.METRICS_BEARER_TOKEN?.trim();
  if (!token) {
    return null;
  }
  if (token.length < 32) {
    throw new Error("METRICS_BEARER_TOKEN must contain at least 32 characters");
  }
  return token;
}

export function hasMetricsAccess(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) {
    return false;
  }
  const expected = Buffer.from(token);
  const provided = Buffer.from(match[1]);
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
