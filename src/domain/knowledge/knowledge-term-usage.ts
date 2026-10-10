import type { OrganizationAccess } from "../identity/organization-access";

export interface KnowledgeOntologyTermUsage {
  readonly term: string;
  readonly count: number;
}

export interface KnowledgeOntologyTermUsageSummary {
  readonly nodeKinds: readonly KnowledgeOntologyTermUsage[];
  readonly edgePredicates: readonly KnowledgeOntologyTermUsage[];
}

export interface KnowledgeTermUsageRepository {
  collect(access: OrganizationAccess): Promise<KnowledgeOntologyTermUsageSummary>;
}
