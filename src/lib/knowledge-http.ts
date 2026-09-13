import { KnowledgeSourceNotFoundError } from "@/application/knowledge/authorize-knowledge-source";
import { KnowledgeNodeNotFoundError } from "@/application/knowledge/create-knowledge-edge";
import { KnowledgeGraphAccessDeniedError } from "@/application/knowledge/create-knowledge-node";
import { KnowledgeEdgeNotFoundError } from "@/application/knowledge/delete-knowledge-resource";
import { InvalidKnowledgeNodeMergeError } from "@/application/knowledge/merge-knowledge-nodes";
import {
  KnowledgeOntologyAccessDeniedError,
  KnowledgeOntologySuggestionUnavailableError
} from "@/application/knowledge/recommend-ontology";
import { InvalidKnowledgeSearchError } from "@/application/knowledge/search-knowledge-nodes";
import {
  InvalidKnowledgeGraphError,
  type KnowledgeEdge,
  type KnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import { KnowledgeOntologyViolationError } from "@/domain/knowledge/knowledge-ontology";
import type { KnowledgeNodeSearchHit } from "@/domain/knowledge/knowledge-graph-repository";

import { aiErrorResponse } from "./ai-http";
import { KnowledgeScopeChangedError } from "@/domain/knowledge/knowledge-scope-change";
import { AmbiguousKnowledgeIdentityError } from "@/domain/knowledge/knowledge-alias";

export function knowledgeErrorResponse(error: unknown): Response | null {
  if (error instanceof AmbiguousKnowledgeIdentityError) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof KnowledgeScopeChangedError) return Response.json({ error: error.message }, { status: 409 });
  const aiResponse = aiErrorResponse(error);
  if (aiResponse) {
    return aiResponse;
  }
  if (error instanceof KnowledgeSourceNotFoundError) {
    return Response.json(
      { error: "Knowledge source not found" },
      { status: 404 }
    );
  }
  if (error instanceof KnowledgeNodeNotFoundError) {
    return Response.json({ error: "Knowledge node not found" }, { status: 404 });
  }
  if (error instanceof KnowledgeEdgeNotFoundError) {
    return Response.json({ error: "Knowledge edge not found" }, { status: 404 });
  }
  if (error instanceof KnowledgeGraphAccessDeniedError) {
    return Response.json(
      { error: "Knowledge graph access denied" },
      { status: 403 }
    );
  }
  if (error instanceof KnowledgeOntologyAccessDeniedError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof KnowledgeOntologySuggestionUnavailableError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof KnowledgeOntologyViolationError) {
    return Response.json(
      { error: "knowledge ontology violation", violations: error.violations },
      { status: 422 }
    );
  }
  if (
    error instanceof InvalidKnowledgeGraphError ||
    error instanceof InvalidKnowledgeNodeMergeError ||
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
    aliases: node.aliases,
    ...(node.summary ? { summary: node.summary } : {}),
    properties: node.properties,
    sources: node.sources,
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
    sources: edge.sources,
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
