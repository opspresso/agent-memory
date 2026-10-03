import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapConfiguration: vi.fn(),
  prepareDatabase: vi.fn(),
  applySettings: vi.fn(),
  initializeInstallation: vi.fn(),
  productionConfiguration: vi.fn(),
  initializeGraph: vi.fn(),
  initializeTelemetry: vi.fn(),
  registerShutdown: vi.fn(),
  readAiLimits: vi.fn(),
  readMetricsToken: vi.fn(),
  startWorker: vi.fn(),
  logError: vi.fn(),
  flush: vi.fn(),
  closeDatabase: vi.fn(),
  stopQueue: vi.fn(),
  closeGraph: vi.fn(),
  shutdownTelemetry: vi.fn()
}));

vi.mock("@/lib/production-config", () => ({
  assertProductionBootstrapConfiguration: mocks.bootstrapConfiguration,
  assertProductionConfiguration: mocks.productionConfiguration
}));
vi.mock("@/lib/prepare-database", () => ({ prepareDatabase: mocks.prepareDatabase }));
vi.mock("@/lib/runtime-settings", () => ({ applyRuntimeSettingsOverrides: mocks.applySettings }));
vi.mock("@/lib/installation", () => ({ installationRepository: { initialize: mocks.initializeInstallation } }));
vi.mock("@/lib/neo4j", () => ({ initializeKnowledgeGraph: mocks.initializeGraph, neo4jDriver: { close: mocks.closeGraph } }));
vi.mock("@/lib/container", () => ({ database: { close: mocks.closeDatabase }, documentIngestionQueue: { stop: mocks.stopQueue } }));
vi.mock("@/infrastructure/observability/telemetry", () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  shutdownTelemetry: mocks.shutdownTelemetry
}));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { error: mocks.logError, flush: mocks.flush } }));
vi.mock("@/lib/runtime-lifecycle", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/runtime-lifecycle")>(), registerRuntimeShutdown: mocks.registerShutdown
}));
vi.mock("@/infrastructure/ai/request-limiter", () => ({ readAiRequestLimits: mocks.readAiLimits }));
vi.mock("@/lib/metrics-auth", () => ({ readMetricsToken: mocks.readMetricsToken }));
vi.mock("@/lib/document-worker", () => ({ startDocumentWorker: mocks.startWorker }));

describe("instrumentation startup", () => {
  const processExited = new Error("process exited with failure");
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOCUMENT_WORKER_ENABLED", "true");
    vi.spyOn(process, "exit").mockImplementation(() => { throw processExited; });
  });

  it("completes initialization without terminating a healthy process", async () => {
    const { register } = await import("@/instrumentation");
    await register();
    expect(mocks.initializeGraph).toHaveBeenCalledOnce();
    expect(mocks.registerShutdown).toHaveBeenCalledOnce();
    expect(mocks.startWorker).toHaveBeenCalledOnce();
    expect(process.exit).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("closes physical database connections between queue and remaining dependency shutdown", async () => {
    const { register } = await import("@/instrumentation");
    await register();
    await mocks.registerShutdown.mock.calls[0]![0]();
    expect(mocks.closeDatabase).toHaveBeenCalledOnce();
    expect(mocks.stopQueue.mock.invocationCallOrder[0]).toBeLessThan(mocks.closeDatabase.mock.invocationCallOrder[0]!);
    expect(mocks.closeDatabase.mock.invocationCallOrder[0]).toBeLessThan(mocks.closeGraph.mock.invocationCallOrder[0]!);
    expect(mocks.closeGraph.mock.invocationCallOrder[0]).toBeLessThan(mocks.shutdownTelemetry.mock.invocationCallOrder[0]!);
  });

  it.each([
    { stage: "database", operation: mocks.prepareDatabase },
    { stage: "graph", operation: mocks.initializeGraph },
    { stage: "worker", operation: mocks.startWorker }
  ])("exits on a production $stage initialization failure", async ({ operation }) => {
    const failure = new Error("dependency unavailable");
    operation.mockRejectedValue(failure);
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toBe(processExited);
    expect(mocks.logError).toHaveBeenCalledWith({ err: failure }, "runtime initialization failed");
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(process.exit).mock.invocationCallOrder[0]!);
  });

  it("does not initialize later dependencies after a database failure", async () => {
    mocks.prepareDatabase.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toBe(processExited);
    expect(mocks.applySettings).not.toHaveBeenCalled();
    expect(mocks.startWorker).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("preserves development startup errors without terminating the dev server", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const failure = new Error("dependency unavailable");
    mocks.prepareDatabase.mockRejectedValue(failure);
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toBe(failure);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each(["error", "flush"] as const)("still exits if the failure logger's %s operation throws", async (operation) => {
    const startupFailure = new Error("dependency unavailable");
    mocks.prepareDatabase.mockRejectedValue(startupFailure);
    (operation === "error" ? mocks.logError : mocks.flush).mockImplementation(() => { throw new Error("logger unavailable"); });
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toBe(processExited);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mocks.logError).toHaveBeenCalledWith({ err: startupFailure }, "runtime initialization failed");
  });

  it("does not initialize the Node.js runtime in an edge process", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("@/instrumentation");
    await register();
    expect(mocks.prepareDatabase).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
