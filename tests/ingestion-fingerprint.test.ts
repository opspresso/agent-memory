import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingestionFingerprint } from "@/lib/ingestion-fingerprint";
import { documentIngestSchema } from "@/lib/document-schemas";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("ingestion fingerprints", () => {
  it("sorts object keys while retaining array order and JSON undefined semantics", () => {
    expect(ingestionFingerprint({ b: 2, a: [{ z: 0, a: 1, absent: undefined }, undefined] }))
      .toBe(hash('{"a":[{"a":1,"z":0},null],"b":2}'));
    expect(ingestionFingerprint([1, 2])).not.toBe(ingestionFingerprint([2, 1]));
  });

  it("handles deep document metadata accepted by the public schema", () => {
    const metadata: Record<string, unknown> = JSON.parse('{"x":'.repeat(3000) + '0' + '}'.repeat(3000));
    expect(documentIngestSchema.safeParse({ idempotencyKey: "nested", scope: { kind: "user" },
      title: "Deep metadata", mimeType: "text/plain", content: "value", metadata }).success).toBe(true);
    expect(ingestionFingerprint({ metadata })).toBe(hash(JSON.stringify({ metadata })));
  });

  it("keeps special JSON property names without altering object prototypes", () => {
    const value = JSON.parse('{"__proto__":{"value":1},"constructor":2}');
    expect(ingestionFingerprint(value)).toBe(hash('{"__proto__":{"value":1},"constructor":2}'));
    expect(ingestionFingerprint(value)).not.toBe(ingestionFingerprint({ constructor: 2 }));
  });

  it("serializes shared objects normally and rejects cycles without an endless traversal", () => {
    const shared = { b: 2, a: 1 };
    expect(ingestionFingerprint({ second: shared, first: shared }))
      .toBe(hash('{"first":{"a":1,"b":2},"second":{"a":1,"b":2}}'));
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => ingestionFingerprint(cyclic)).toThrow(TypeError);
  });
});
