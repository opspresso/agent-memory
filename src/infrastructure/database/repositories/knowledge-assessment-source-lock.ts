import { and, asc, eq, sql } from "drizzle-orm";
import type { ScopedResource } from "@/domain/identity/organization-access";
import { scopeCovers } from "@/domain/identity/scope-coverage";
import { KnowledgeAssessmentUnavailableError, type KnowledgeCandidateAssessment } from "@/domain/knowledge/knowledge-assessment";
import { KnowledgeScopeChangedError } from "@/domain/knowledge/knowledge-scope-change";
import { knowledgeNodes } from "../schema";
import { inArrayParameter } from "./array-predicate";
import { knowledgeScopeFromRow } from "./knowledge-node-persistence";
import { assertKnowledgeSourceScopes, type KnowledgeTransaction } from "./knowledge-scope-lock";
import { resolvedContextNodes } from "./knowledge-context-identity";

/** The caller holds the knowledge scope lock before acquiring node and source locks. */
export async function lockKnowledgeAssessmentSources(transaction: KnowledgeTransaction, scope: ScopedResource, assessment: KnowledgeCandidateAssessment) {
  if (!Array.isArray(assessment.contextNodeIds)) throw new KnowledgeAssessmentUnavailableError();
  const nodeIds = [...new Set(assessment.contextNodeIds)];
  if (nodeIds.length) {
    const resolved = await transaction.execute<{ contextNodeId: string; id: string }>(
      resolvedContextNodes(scope.organizationId, sql`${JSON.stringify(nodeIds)}::jsonb`));
    const identities = new Map<string, Set<string>>();
    for (const row of resolved.rows) {
      const targets = identities.get(row.contextNodeId) ?? new Set<string>();
      targets.add(row.id);
      identities.set(row.contextNodeId, targets);
    }
    if (nodeIds.some((id) => identities.get(id)?.size !== 1)) throw new KnowledgeScopeChangedError();
    const currentIds = [...new Set(resolved.rows.map((row) => row.id))];
    const nodes = await transaction.select().from(knowledgeNodes).where(and(
      eq(knowledgeNodes.organizationId, scope.organizationId), inArrayParameter(knowledgeNodes.id, currentIds)
    )).orderBy(asc(knowledgeNodes.id)).for("share");
    if (nodes.length !== currentIds.length || nodes.some((node) => !scopeCovers(knowledgeScopeFromRow(node), scope))) {
      throw new KnowledgeScopeChangedError();
    }
  }
  await assertKnowledgeSourceScopes(transaction, scope, assessment.sources);
}
