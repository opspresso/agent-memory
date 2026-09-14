export interface KnowledgeTopologySnapshot {
  readonly organizationId: string;
  readonly revision: string;
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly canonicalName: string }[];
  readonly edges: readonly { readonly id: string; readonly sourceNodeId: string; readonly targetNodeId: string; readonly predicate: string }[];
}

export interface KnowledgeTopologyStore {
  revision(organizationId: string): Promise<string | undefined>;
  replace(snapshot: KnowledgeTopologySnapshot): Promise<void>;
  incidentEdgeIds(organizationId: string, nodeIds: readonly string[], afterId: string | undefined, limit: number): Promise<readonly string[]>;
}

export interface KnowledgeTopologyReader {
  prepare(organizationId: string): Promise<void>;
  incidentEdgeIds: KnowledgeTopologyStore["incidentEdgeIds"];
}

export class KnowledgeGraphUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Knowledge graph is unavailable", options);
    this.name = "KnowledgeGraphUnavailableError";
  }
}
