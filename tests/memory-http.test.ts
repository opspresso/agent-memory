import { describe, expect, it } from "vitest";

import { createMemory } from "@/domain/memory/memory";
import {
  parseIfMatch,
  publicMemory,
  publicMemoryForAccess,
  publicMemoryVersion,
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
    const unsafe = new Request("https://memory.example.com/api/memory", {
      headers: { "if-match": '"9007199254740992"' }
    });

    expect(parseIfMatch(weak)).toBeNull();
    expect(parseIfMatch(wildcard)).toBeNull();
    expect(parseIfMatch(zero)).toBeNull();
    expect(parseIfMatch(unsafe)).toBeNull();
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

  it("rejects a declared JSON body larger than 1 MiB before reading it", async () => {
    const result = await readJsonBody(
      new Request("https://memory.example.com/api/memory", {
        method: "POST",
        headers: { "content-length": "1048577" },
        body: "{}"
      })
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.response.status).toBe(413);
      await expect(result.response.json()).resolves.toEqual({
        error: "JSON body exceeds 1 MiB"
      });
    }
  });

  it("stops reading a streamed JSON body larger than 1 MiB", async () => {
    const result = await readJsonBody(
      new Request("https://memory.example.com/api/memory", {
        method: "POST",
        body: JSON.stringify({ content: "a".repeat(1_048_576) })
      })
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.response.status).toBe(413);
    }
  });

  it("reads valid JSON within the request limit", async () => {
    const result = await readJsonBody(
      new Request("https://memory.example.com/api/memory", {
        method: "POST",
        body: JSON.stringify({ title: "Runbook" })
      })
    );

    expect(result).toEqual({ valid: true, value: { title: "Runbook" } });
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
    expect(
      publicMemoryForAccess(memory, {
        organizationId: "organization-1",
        userId: "user-1",
        role: "owner",
        teams: []
      })
    ).toMatchObject({
      accessGrants: memory.accessGrants,
      capabilities: { write: true, manage: true }
    });
    expect(
      publicMemoryForAccess(memory, {
        organizationId: "organization-1",
        userId: "user-2",
        role: "member",
        teams: []
      })
    ).toMatchObject({
      capabilities: { write: false, manage: false }
    });

    const version = publicMemoryVersion({
      memoryId: memory.id,
      version: memory.version,
      title: memory.title,
      content: memory.content,
      source: memory.source,
      embedding: memory.embedding,
      accessGrants: memory.accessGrants,
      validFrom: memory.validFrom,
      status: memory.status,
      changedBy: memory.createdBy,
      createdAt: memory.updatedAt
    });
    expect(version).toHaveProperty("accessGrants", memory.accessGrants);
    expect(version).toHaveProperty("embeddingModel", "embedding-model");
    expect(version).not.toHaveProperty("embedding");
  });
});
