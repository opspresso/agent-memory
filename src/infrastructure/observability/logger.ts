import pino from "pino";

interface ErrorWithCode extends Error {
  readonly code?: unknown;
}

export function serializeErrorForLog(error: unknown) {
  if (!(error instanceof Error)) {
    return { type: "UnknownError" };
  }
  const type = /^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(error.name)
    ? error.name
    : "Error";
  const candidateCode = (error as ErrorWithCode).code;
  const code =
    typeof candidateCode === "string" &&
    /^[A-Z0-9_-]{1,64}$/.test(candidateCode)
      ? candidateCode
      : undefined;
  const stack = error.stack
    ?.split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
  return {
    type,
    ...(code ? { code } : {}),
    ...(stack ? { stack } : {})
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "secret",
      "token",
      "*.password",
      "*.secret",
      "*.token",
      "req.headers.authorization",
      "req.headers.cookie"
    ],
    censor: "[REDACTED]"
  },
  serializers: { err: serializeErrorForLog }
});
