import { describe, expect, it } from "vitest";
import { embeddingBatchFingerprint, readEmbeddingConfiguration, readEmbeddingDimensions, readEmbeddingMinimumScore } from "@/lib/embedding-configuration";
import { validateRuntimeEnvironment } from "@/lib/runtime-configuration";

describe("embedding dimensions", () => {
  it("binds checkpoints to exact inputs and embedding semantics without binding credential rotation", () => {
    const environment = { EMBEDDING_MODEL: " model ", EMBEDDING_BASE_URL: "https://provider.test/v1/", EMBEDDING_DIM: "2", EMBEDDING_API_KEY: "first-key" };
    const configuration = readEmbeddingConfiguration(environment)!;
    expect(configuration).toMatchObject({ model: "model", baseUrl: "https://provider.test/v1", dimensions: 2 });
    const fingerprint = embeddingBatchFingerprint(configuration);
    const key = fingerprint(["Alpha", "Beta"]);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const rotated = readEmbeddingConfiguration({ ...environment, EMBEDDING_API_KEY: "rotated-key" })!;
    expect(embeddingBatchFingerprint(rotated)(["Alpha", "Beta"])).toBe(key);
    for (const change of [{ model: "other-model" }, { baseUrl: "https://other.test/v1" }, { dimensions: 3 }]) {
      expect(embeddingBatchFingerprint({ ...configuration, ...change })(["Alpha", "Beta"])).not.toBe(key);
    }
    expect(fingerprint(["Beta", "Alpha"])).not.toBe(key);
    expect(fingerprint(["Alpha ", "Beta"])).not.toBe(key);
    expect(readEmbeddingConfiguration({})).toBeUndefined();
    expect(() => readEmbeddingConfiguration({ EMBEDDING_MODEL: "model" })).toThrow("EMBEDDING_BASE_URL");
  });
  it.each([undefined, "native", " NATIVE "])("omits the provider dimension for %s", (value) => {
    expect(readEmbeddingDimensions({ EMBEDDING_DIM: value })).toBeUndefined();
  });
  it.each(["1", "1024", " 1536 ", "16000"])("reads an explicit positive dimension %s", (value) => {
    expect(readEmbeddingDimensions({ EMBEDDING_DIM: value })).toBe(Number(value));
  });
  it.each(["", "0", "-1", "1.5", "NaN", "Infinity", "16001", "9007199254740992"])("rejects invalid dimensions %s at the settings boundary", (value) => {
    expect(() => validateRuntimeEnvironment({ AUTH_PASSWORD: "true", EMBEDDING_DIM: value })).toThrow("EMBEDDING_DIM must be native or an integer between 1 and 16000");
  });
});

describe("embedding similarity floor", () => {
  it("defaults to 0.25 and accepts the full configurable range", () => {
    expect(readEmbeddingMinimumScore({})).toBe(0.25);
    for (const value of ["0", "0.25", "0.8", "1"]) {
      expect(readEmbeddingMinimumScore({ EMBEDDING_MIN_SCORE: value })).toBe(Number(value));
    }
  });
  it.each(["", "-0.1", "1.1", "NaN", "Infinity"])("rejects an invalid similarity floor %s", (value) => {
    expect(() => validateRuntimeEnvironment({ AUTH_PASSWORD: "true", EMBEDDING_MIN_SCORE: value })).toThrow("EMBEDDING_MIN_SCORE must be between 0 and 1");
  });
});
