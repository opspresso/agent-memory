export type RuntimeSignal = "SIGINT" | "SIGTERM";

interface RuntimeProcess {
  exit(code: number): void;
  once(signal: RuntimeSignal, listener: () => void): void;
}

interface RuntimeLogger {
  error(value: Readonly<{ err: unknown; signal: RuntimeSignal }>, message: string): void;
  info(value: Readonly<{ signal: RuntimeSignal }>, message: string): void;
}

export interface RuntimeShutdownStep {
  readonly name: string;
  readonly execute: () => Promise<void>;
}

export async function runRuntimeShutdownSteps(
  steps: readonly RuntimeShutdownStep[]
): Promise<void> {
  const failures: Error[] = [];
  for (const step of steps) {
    try {
      await step.execute();
    } catch (cause) {
      failures.push(new Error(`${step.name} shutdown failed`, { cause }));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "runtime shutdown failed");
  }
}

export function registerRuntimeShutdown(
  shutdown: () => Promise<void>,
  logger: RuntimeLogger,
  runtime: RuntimeProcess = process
): void {
  let shutdownTask: Promise<void> | undefined;

  function handle(signal: RuntimeSignal): void {
    shutdownTask ??= (async () => {
      try {
        await shutdown();
        logger.info({ signal }, "runtime shutdown completed");
        runtime.exit(0);
      } catch (err) {
        logger.error({ err, signal }, "runtime shutdown failed");
        runtime.exit(1);
      }
    })();
  }

  runtime.once("SIGINT", () => handle("SIGINT"));
  runtime.once("SIGTERM", () => handle("SIGTERM"));
}
