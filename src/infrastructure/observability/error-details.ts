import { isSafeOperationalError, SafeOperationalError } from "./safe-operational-error";

interface SafeErrorDetails {
  readonly type: string;
  readonly code?: string;
  readonly message?: string;
  readonly cause?: SafeErrorDetails;
  readonly errors?: readonly SafeErrorDetails[];
}

function serializeCause(error: unknown, depth: number): SafeErrorDetails {
  if (!(error instanceof Error)) return { type: "UnknownError" };
  const type = /^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(error.name) ? error.name : "Error";
  const candidateCode = (error as Error & { readonly code?: unknown }).code;
  const code = typeof candidateCode === "string" && /^[A-Z0-9_-]{1,64}$/.test(candidateCode) ? candidateCode : undefined;
  const cause = depth > 0 && error.cause ? serializeCause(error.cause, depth - 1) : undefined;
  const errors = depth > 0 && error instanceof AggregateError
    ? error.errors.slice(0, 5).map((candidate) => serializeCause(candidate, depth - 1)) : undefined;
  return { type, ...(code ? { code } : {}), ...(isSafeOperationalError(error) ? { message: error.message } : {}),
    ...(cause ? { cause } : {}), ...(errors?.length ? { errors } : {}) };
}

export function serializeErrorForLog(error: unknown): SafeErrorDetails {
  return serializeCause(error, 3);
}

/** Frameworks persist Error properties independently of the logger; message must be fixed application text. */
export function safeErrorForBoundary(error: unknown, message: string): Error & { readonly details: SafeErrorDetails } {
  const details = serializeErrorForLog(error);
  // Never attach the original error, its stack, or its arbitrary own properties.
  return Object.assign(new SafeOperationalError(message, { code: details.code }), { details });
}
