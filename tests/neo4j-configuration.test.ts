import { describe, expect, it } from "vitest";
import { readNeo4jConfiguration } from "@/lib/neo4j-configuration";
import { KnowledgeGraphUnavailableError } from "@/domain/knowledge/knowledge-topology";
import { knowledgeErrorResponse } from "@/lib/knowledge-http";

describe("Neo4j configuration and HTTP failures", () => {
  it("validates supported protocols and separates credentials from URLs", () => {
    expect(readNeo4jConfiguration({})).toMatchObject({ uri:"bolt://127.0.0.1:7687", username:"neo4j", database:"neo4j" });
    for (const uri of ["bolt://graph:7687", "neo4j+s://graph.example.com", "bolt+ssc://graph:7687"]) {
      expect(readNeo4jConfiguration({ NEO4J_URI:uri }).uri).toBe(uri);
    }
    for (const uri of ["", "http://graph:7474", "bolt://user:secret@graph:7687"]) {
      expect(() => readNeo4jConfiguration({ NEO4J_URI:uri })).toThrow("NEO4J_URI");
    }
    for (const key of ["NEO4J_USERNAME", "NEO4J_PASSWORD", "NEO4J_DATABASE"]) {
      expect(() => readNeo4jConfiguration({ [key]:" " })).toThrow(key);
    }
  });
  it("returns a retryable status without connection strings or source data", async () => {
    const response = knowledgeErrorResponse(new KnowledgeGraphUnavailableError({ cause:new Error("secret connection details") }));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error:"Knowledge graph is unavailable" });
  });
});
