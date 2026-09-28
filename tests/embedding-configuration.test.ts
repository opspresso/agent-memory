import { describe, expect, it } from "vitest";
import { readEmbeddingDimensions } from "@/lib/embedding-configuration";
import { validateRuntimeEnvironment } from "@/lib/runtime-configuration";

describe("embedding dimensions", () => {
  it.each([undefined, "native", " NATIVE "])("omits the provider dimension for %s", (value) => {
    expect(readEmbeddingDimensions({ EMBEDDING_DIM: value })).toBeUndefined();
  });
  it.each(["1", "1024", " 1536 "])("reads an explicit positive dimension %s", (value) => {
    expect(readEmbeddingDimensions({ EMBEDDING_DIM: value })).toBe(Number(value));
  });
  it.each(["", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])("rejects invalid dimensions %s at the settings boundary", (value) => {
    expect(() => validateRuntimeEnvironment({ AUTH_PASSWORD: "true", EMBEDDING_DIM: value })).toThrow("EMBEDDING_DIM must be native or a positive integer");
  });
});
