import { describe, expect, it, vi } from "vitest";

import {
  buildRecommendKnowledgeOntologyTerms,
  buildSuggestKnowledgeOntology,
  KnowledgeOntologyAccessDeniedError,
  KnowledgeOntologySuggestionUnavailableError
} from "@/application/knowledge/recommend-ontology";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { OrganizationKnowledgeOntology } from "@/domain/knowledge/knowledge-ontology-reader";
import type { KnowledgeOntologyTermUsageSummary } from "@/domain/knowledge/knowledge-term-usage";

const admin: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "admin-1",
  role: "admin",
  teams: []
};
const member: OrganizationAccess = { ...admin, role: "member" };

function ontologyReader(result: OrganizationKnowledgeOntology | null = null) {
  return { findByOrganization: vi.fn().mockResolvedValue(result) };
}

function usageRepository(summary: KnowledgeOntologyTermUsageSummary) {
  return { collect: vi.fn().mockResolvedValue(summary) };
}

describe("knowledge ontology recommendation", () => {
  it("recommends observed terms that are not in the dictionary yet", async () => {
    const recommend = buildRecommendKnowledgeOntologyTerms({
      ontologyReader: ontologyReader({
        mode: "warn",
        ontology: { nodeKinds: ["service"], edgePredicates: ["depends_on"] }
      }),
      usageRepository: usageRepository({
        nodeKinds: [
          { term: "service", count: 9 },
          { term: "pipeline", count: 3 },
          { term: "cluster", count: 7 }
        ],
        edgePredicates: [
          { term: "depends_on", count: 5 },
          { term: "stores_in", count: 2 }
        ]
      })
    });

    await expect(recommend(admin)).resolves.toEqual({
      nodeKinds: [
        { term: "cluster", count: 7 },
        { term: "pipeline", count: 3 }
      ],
      edgePredicates: [{ term: "stores_in", count: 2 }]
    });
  });

  it("restricts recommendations to organization administrators", async () => {
    const usage = usageRepository({ nodeKinds: [], edgePredicates: [] });
    const recommend = buildRecommendKnowledgeOntologyTerms({
      ontologyReader: ontologyReader(),
      usageRepository: usage
    });

    await expect(recommend(member)).rejects.toBeInstanceOf(
      KnowledgeOntologyAccessDeniedError
    );
    expect(usage.collect).not.toHaveBeenCalled();
  });

  it("normalizes and filters AI suggestions against the current dictionary", async () => {
    const suggest = buildSuggestKnowledgeOntology({
      ontologyReader: ontologyReader({
        mode: "warn",
        ontology: { nodeKinds: ["service"], edgePredicates: [] }
      }),
      usageRepository: usageRepository({
        nodeKinds: [{ term: "pipeline", count: 3 }],
        edgePredicates: []
      }),
      suggestionService: {
        suggest: vi.fn().mockResolvedValue({
          nodeKinds: [" Pipeline ", "service", "Award"],
          edgePredicates: [" STORES_IN "]
        })
      }
    });

    await expect(suggest(admin)).resolves.toEqual({
      nodeKinds: ["pipeline", "recognition"],
      edgePredicates: ["stores_in"]
    });
  });

  it("reports when no suggestion model is configured", async () => {
    const suggest = buildSuggestKnowledgeOntology({
      ontologyReader: ontologyReader(),
      usageRepository: usageRepository({ nodeKinds: [], edgePredicates: [] })
    });

    await expect(suggest(admin)).rejects.toBeInstanceOf(
      KnowledgeOntologySuggestionUnavailableError
    );
  });
});
