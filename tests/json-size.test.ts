import { describe, expect, it } from "vitest";

import { serializedJsonByteLength } from "@/domain/shared/json-size";

describe("serialized JSON byte length", () => {
  it("treats values that cannot be serialized as oversized", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    let deeplyNested: unknown = 0;
    for (let depth = 0; depth < 20_000; depth += 1) {
      deeplyNested = { value: deeplyNested };
    }

    expect(serializedJsonByteLength(circular)).toBe(Number.POSITIVE_INFINITY);
    expect(serializedJsonByteLength(deeplyNested)).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});
