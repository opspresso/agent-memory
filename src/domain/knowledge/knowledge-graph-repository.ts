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
  findNodesByCanonicalNames(
    access: OrganizationAccess,
    scope: KnowledgeNode["scope"],
    canonicalNames: readonly string[]
  ): Promise<readonly KnowledgeNode[]>;
  findNodeById(
    organizationId: string,
    nodeId: string
  ): Promise<KnowledgeNode | null>;
  deleteNode(organizationId: string, nodeId: string): Promise<boolean>;
  mergeNodes(input: {
    readonly organizationId: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly mergedBy: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<KnowledgeNode | null>;
  saveEdge(edge: KnowledgeEdge): Promise<KnowledgeEdge>;
  findEdgeById(
    organizationId: string,
    edgeId: string
  ): Promise<KnowledgeEdge | null>;
  deleteEdge(organizationId: string, edgeId: string): Promise<boolean>;
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
