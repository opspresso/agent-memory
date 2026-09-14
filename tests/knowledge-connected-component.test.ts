import { describe, expect, it } from "vitest";
import { connectedKnowledgeNeighborhood } from "@/domain/knowledge/knowledge-connected-component";
import { createKnowledgeEdge, createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";

const scope = { organizationId:"org",kind:"organization" as const };
const now = new Date("2026-09-13T00:00:00Z");
const nodes = ["root","bridge","leaf"].map((id) => createKnowledgeNode({ id,scope,kind:"person",canonicalName:id,source:{chunkId:"source"},now }));
const edge = (id: string, sourceNodeId: string, targetNodeId: string) => createKnowledgeEdge({ id,scope,organizationId:"org",sourceNodeId,targetNodeId,predicate:"knows",source:{chunkId:"source"},now });

describe("neighborhood connectivity after provenance filtering", () => {
  it("removes descendants when the root's connecting evidence disappears", () => {
    const result = connectedKnowledgeNeighborhood({ nodes,edges:[edge("second","bridge","leaf")] },"root");
    expect(result.nodes.map((node) => node.id)).toEqual(["root"]);
    expect(result.edges).toEqual([]);
  });
  it("follows readable edges in either direction while retaining isolated roots", () => {
    const result = connectedKnowledgeNeighborhood({ nodes,edges:[edge("first","bridge","root"),edge("second","bridge","leaf")] },"root");
    expect(result.nodes).toEqual(nodes);
    expect(result.edges).toHaveLength(2);
    expect(connectedKnowledgeNeighborhood({ nodes,edges:[] },"missing")).toEqual({nodes:[],edges:[]});
  });
});
