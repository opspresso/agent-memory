export class SafeOperationalError extends Error {
  readonly safeForLogging = true;
  readonly code?: string;

  constructor(
    message: string,
    options?: ErrorOptions & Readonly<{ code?: string }>
  ) {
    super(message, options);
    this.name = "SafeOperationalError";
    this.code = options?.code;
  }
}

export function isSafeOperationalError(
  error: Error
): error is SafeOperationalError {
  return (
    error instanceof SafeOperationalError &&
    error.safeForLogging === true
  );
}
