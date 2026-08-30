export interface KnowledgeOntologyTermUsage {
  readonly term: string;
  readonly count: number;
}

export interface KnowledgeOntologyTermUsageSummary {
  readonly nodeKinds: readonly KnowledgeOntologyTermUsage[];
  readonly edgePredicates: readonly KnowledgeOntologyTermUsage[];
}

export interface KnowledgeTermUsageRepository {
  collect(organizationId: string): Promise<KnowledgeOntologyTermUsageSummary>;
}
