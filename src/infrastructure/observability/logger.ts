import pino from "pino";

import { isSafeOperationalError } from "./safe-operational-error";

interface ErrorWithCode extends Error {
  readonly code?: unknown;
}

function errorType(error: Error): string {
  return /^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(error.name)
    ? error.name
    : "Error";
}

function errorCode(error: Error): string | undefined {
  const candidateCode = (error as ErrorWithCode).code;
  return typeof candidateCode === "string" &&
    /^[A-Z0-9_-]{1,64}$/.test(candidateCode)
    ? candidateCode
    : undefined;
}

function serializeCause(error: unknown, depth: number): object {
  if (!(error instanceof Error)) {
    return { type: "UnknownError" };
  }
  const code = errorCode(error);
  const nested = depth > 0 && error.cause
    ? serializeCause(error.cause, depth - 1)
    : undefined;
  const errors =
    depth > 0 && error instanceof AggregateError
      ? error.errors
          .slice(0, 5)
          .map((candidate) => serializeCause(candidate, depth - 1))
      : undefined;
  return {
    type: errorType(error),
    ...(code ? { code } : {}),
    ...(isSafeOperationalError(error) ? { message: error.message } : {}),
    ...(nested ? { cause: nested } : {}),
    ...(errors && errors.length > 0 ? { errors } : {})
  };
}

export function serializeErrorForLog(error: unknown) {
  return serializeCause(error, 3);
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
