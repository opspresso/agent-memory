import { KnowledgeNodeNotFoundError } from "@/application/knowledge/create-knowledge-edge";
import { KnowledgeGraphAccessDeniedError } from "@/application/knowledge/create-knowledge-node";
import { InvalidKnowledgeSearchError } from "@/application/knowledge/search-knowledge-nodes";
import {
  InvalidKnowledgeGraphError,
  type KnowledgeEdge,
  type KnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeNodeSearchHit } from "@/domain/knowledge/knowledge-graph-repository";

export function knowledgeErrorResponse(error: unknown): Response | null {
  if (error instanceof KnowledgeNodeNotFoundError) {
    return Response.json({ error: "Knowledge node not found" }, { status: 404 });
  }
  if (error instanceof KnowledgeGraphAccessDeniedError) {
    return Response.json(
      { error: "Knowledge graph access denied" },
      { status: 403 }
    );
  }
  if (
    error instanceof InvalidKnowledgeGraphError ||
    error instanceof InvalidKnowledgeSearchError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
}

export function publicKnowledgeNode(node: KnowledgeNode) {
  return {
    id: node.id,
    scope: node.scope,
    kind: node.kind,
    canonicalName: node.canonicalName,
    ...(node.summary ? { summary: node.summary } : {}),
    properties: node.properties,
    source: node.source,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...(node.embedding ? { embeddingModel: node.embedding.model } : {})
  };
}

export function publicKnowledgeEdge(edge: KnowledgeEdge) {
  return {
    id: edge.id,
    scope: edge.scope,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    predicate: edge.predicate,
    properties: edge.properties,
    source: edge.source,
    createdAt: edge.createdAt
  };
}

export function publicKnowledgeHit(hit: KnowledgeNodeSearchHit) {
  return {
    node: publicKnowledgeNode(hit.node),
    lexicalScore: hit.lexicalScore,
    vectorScore: hit.vectorScore,
    score: hit.score
  };
}
