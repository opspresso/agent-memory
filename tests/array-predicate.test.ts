import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { inArrayParameter } from "@/infrastructure/database/repositories/array-predicate";
import { knowledgeNodes } from "@/infrastructure/database/schema";

describe("array predicates", () => {
  it("binds large ID sets as one parameter", () => {
    const ids = Array.from({ length: 70_000 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const query = new PgDialect().sqlToQuery(inArrayParameter(knowledgeNodes.id, ids));
    expect(query.params).toEqual([ids]);
    expect(query.sql).toContain("ANY($1::uuid[])");
  });

  it("keeps canonical names in parameter data, including SQL metacharacters", () => {
    const names = ["Liu Bei", "'); DROP TABLE knowledge_nodes; --", "quoted, name"];
    const query = new PgDialect().sqlToQuery(inArrayParameter(knowledgeNodes.canonicalNameKey, names, "text"));
    expect(query.params).toEqual([names]);
    expect(query.sql).not.toContain("DROP TABLE");
    expect(query.sql).toContain("ANY($1::text[])");
  });
});
