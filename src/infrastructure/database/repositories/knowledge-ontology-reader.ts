import { eq } from "drizzle-orm";

import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";

import type { AgentMemoryDatabase } from "../client";
import { organizations } from "../schema";

export function createKnowledgeOntologyReader(
  db: AgentMemoryDatabase
): KnowledgeOntologyReader {
  return {
    async findByOrganization(organizationId) {
      const [organization] = await db
        .select({
          mode: organizations.ontologyMode,
          ontology: organizations.ontology
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return organization ?? null;
    }
  };
}
