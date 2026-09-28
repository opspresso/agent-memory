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
  flush: vi.fn()
}));

vi.mock("@/lib/production-config", () => ({
  assertProductionBootstrapConfiguration: mocks.bootstrapConfiguration,
  assertProductionConfiguration: mocks.productionConfiguration
}));
vi.mock("@/lib/prepare-database", () => ({ prepareDatabase: mocks.prepareDatabase }));
vi.mock("@/lib/runtime-settings", () => ({ applyRuntimeSettingsOverrides: mocks.applySettings }));
vi.mock("@/lib/installation", () => ({ installationRepository: { initialize: mocks.initializeInstallation } }));
vi.mock("@/lib/neo4j", () => ({ initializeKnowledgeGraph: mocks.initializeGraph, neo4jDriver: {} }));
vi.mock("@/infrastructure/observability/telemetry", () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  shutdownTelemetry: vi.fn()
}));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { error: mocks.logError, flush: mocks.flush } }));
vi.mock("@/lib/runtime-lifecycle", () => ({ registerRuntimeShutdown: mocks.registerShutdown, runRuntimeShutdownSteps: vi.fn() }));
vi.mock("@/infrastructure/ai/request-limiter", () => ({ readAiRequestLimits: mocks.readAiLimits }));
vi.mock("@/lib/metrics-auth", () => ({ readMetricsToken: mocks.readMetricsToken }));
vi.mock("@/lib/document-worker", () => ({ startDocumentWorker: mocks.startWorker }));

describe("instrumentation startup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DOCUMENT_WORKER_ENABLED", "true");
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
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

  it.each([
    { stage: "database", operation: mocks.prepareDatabase },
    { stage: "graph", operation: mocks.initializeGraph },
    { stage: "worker", operation: mocks.startWorker }
  ])("exits on a production $stage initialization failure", async ({ operation }) => {
    const failure = new Error("dependency unavailable");
    operation.mockRejectedValue(failure);
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toBe(failure);
    expect(mocks.logError).toHaveBeenCalledWith({ err: failure }, "runtime initialization failed");
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(process.exit).mock.invocationCallOrder[0]!);
  });

  it("does not initialize later dependencies after a database failure", async () => {
    mocks.prepareDatabase.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow("connection terminated unexpectedly");
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

  it("does not initialize the Node.js runtime in an edge process", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("@/instrumentation");
    await register();
    expect(mocks.prepareDatabase).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
