import type { KnowledgeOntology, KnowledgeOntologyMode } from "./knowledge-ontology";

export interface OrganizationKnowledgeOntology {
  readonly mode: KnowledgeOntologyMode;
  readonly ontology: KnowledgeOntology;
}

export interface KnowledgeOntologyReader {
  findByOrganization(
    organizationId: string
  ): Promise<OrganizationKnowledgeOntology | null>;
}
