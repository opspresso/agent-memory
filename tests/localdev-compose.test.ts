import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const dockerignore = readFileSync(
  new URL("../.dockerignore", import.meta.url),
  "utf8"
);

describe("localdev compose", () => {
  it("owns an independent PostgreSQL 18 and MinIO stack", () => {
    expect(compose).toContain("name: agent-memory-local");
    expect(compose).toContain("pgvector/pgvector:0.8.6-pg18-trixie");
    expect(compose).toContain('"127.0.0.1:5433:5432"');
    expect(compose).toContain('"127.0.0.1:9010:9000"');
    expect(compose).toContain("postgres18-data:/var/lib/postgresql");
  });

  it("initializes the agent-memory bucket", () => {
    expect(compose).toContain("minio-init:");
    expect(compose).toContain('mc mb --ignore-existing "local/$$S3_BUCKET_NAME"');
    expect(compose).toContain("S3_BUCKET_NAME: agent-memory");
  });
});

describe("container build context", () => {
  it("excludes every environment file except the public example", () => {
    expect(dockerignore).toContain(".env*\n!.env.example");
    expect(dockerignore).not.toContain(".env.local");
  });
});
