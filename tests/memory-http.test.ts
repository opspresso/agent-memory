import { describe, expect, it } from "vitest";

import { createMemory } from "@/domain/memory/memory";
import {
  parseIfMatch,
  publicMemory,
  readJsonBody,
  versionEtag
} from "@/lib/memory-http";

describe("memory HTTP concurrency", () => {
  it("serializes and parses strong version ETags", () => {
    const request = new Request("https://memory.example.com/api/memory", {
      headers: { "if-match": versionEtag(42) }
    });

    expect(versionEtag(42)).toBe('"42"');
    expect(parseIfMatch(request)).toBe(42);
  });

  it("rejects weak ETags, wildcard, and invalid versions", () => {
    const weak = new Request("https://memory.example.com/api/memory", {
      headers: { "if-match": 'W/"3"' }
    });
    const wildcard = new Request("https://memory.example.com/api/memory", {
      headers: { "if-match": "*" }
    });
    const zero = new Request("https://memory.example.com/api/memory", {
      headers: { "if-match": '"0"' }
    });

    expect(parseIfMatch(weak)).toBeNull();
    expect(parseIfMatch(wildcard)).toBeNull();
    expect(parseIfMatch(zero)).toBeNull();
  });

  it("returns a 400 result for malformed JSON", async () => {
    const result = await readJsonBody(
      new Request("https://memory.example.com/api/memory", {
        method: "POST",
        body: "{"
      })
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.response.status).toBe(400);
    }
  });

  it("omits raw embeddings and ACL principals from public responses", () => {
    const now = new Date("2026-08-26T00:00:00.000Z");
    const memory = createMemory({
      id: "memory-1",
      kind: "fact",
      scope: { kind: "organization", organizationId: "organization-1" },
      title: "Public response",
      content: "Do not expose vector payloads.",
      source: { type: "system" },
      embedding: { model: "embedding-model", values: [0.1, 0.2] },
      accessGrants: [
        { principalKind: "user", userId: "user-2", permission: "read" }
      ],
      createdBy: "user-1",
      validFrom: now,
      now
    });

    expect(publicMemory(memory)).toMatchObject({
      id: "memory-1",
      embeddingModel: "embedding-model"
    });
    expect(publicMemory(memory)).not.toHaveProperty("embedding");
    expect(publicMemory(memory)).not.toHaveProperty("accessGrants");
  });
});
