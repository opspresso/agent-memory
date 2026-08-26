import type { OrganizationAccess } from "@/domain/identity/organization-access";

import type {
  KnowledgeEdge,
  KnowledgeEmbedding,
  KnowledgeNode
} from "./knowledge-graph";

export interface KnowledgeNodeSearchInput {
  readonly access: OrganizationAccess;
  readonly query: string;
  readonly queryEmbedding?: KnowledgeEmbedding;
  readonly limit: number;
}

export interface KnowledgeNodeSearchHit {
  readonly node: KnowledgeNode;
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly score: number;
}

export interface KnowledgeNeighborhood {
  readonly nodes: readonly KnowledgeNode[];
  readonly edges: readonly KnowledgeEdge[];
}

export interface KnowledgeGraphRepository {
  saveNode(node: KnowledgeNode): Promise<KnowledgeNode>;
  findNodeById(
    organizationId: string,
    nodeId: string
  ): Promise<KnowledgeNode | null>;
  saveEdge(edge: KnowledgeEdge): Promise<KnowledgeEdge>;
  searchNodes(
    input: KnowledgeNodeSearchInput
  ): Promise<readonly KnowledgeNodeSearchHit[]>;
  findNeighborhood(
    access: OrganizationAccess,
    nodeId: string,
    depth: number,
    limit: number
  ): Promise<KnowledgeNeighborhood>;
}
