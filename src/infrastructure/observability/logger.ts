import pino from "pino";

import { serializeErrorForLog } from "./error-details";

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

type AuthenticationLogLevel = "debug" | "info" | "warn" | "error";

interface AuthenticationLogSink {
  debug(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
}

export function createAuthenticationLogger(
  sink: AuthenticationLogSink = logger
) {
  return {
    log(level: AuthenticationLogLevel, message: string): void {
      sink[level]({ component: "better-auth" }, message);
    }
  };
}

export const authenticationLogger = createAuthenticationLogger();
