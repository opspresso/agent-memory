import pino from "pino";

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
  serializers: { err: pino.stdSerializers.err }
});
