import { sql, type SQLWrapper } from "drizzle-orm";
import { knowledgeNodeMerges, knowledgeNodes } from "../schema";

export function contextReferenceUuid(value: SQLWrapper) {
  return sql`CASE WHEN ${value} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN ${value}::uuid END`;
}

/** Preserve original assessment IDs while following explicit, same-organization merge records. */
export function resolvedContextNodes(organizationId: string | SQLWrapper, nodeIds: SQLWrapper) {
  return sql`WITH RECURSIVE context_identity("contextNodeId", id) AS (
    SELECT context_reference.value, ${contextReferenceUuid(sql`context_reference.value`)}
      FROM jsonb_array_elements_text(${nodeIds}) AS context_reference(value)
    UNION
    SELECT context_identity."contextNodeId", context_merge.target_node_id
      FROM context_identity JOIN ${knowledgeNodeMerges} AS context_merge
        ON context_merge.organization_id = ${organizationId} AND context_merge.source_node_id = context_identity.id
      WHERE NOT EXISTS (SELECT 1 FROM ${knowledgeNodes} AS current_context_node
        WHERE current_context_node.organization_id = ${organizationId} AND current_context_node.id = context_identity.id)
  )
  SELECT context_identity."contextNodeId", resolved_context_node.id
    FROM context_identity JOIN ${knowledgeNodes} AS resolved_context_node
      ON resolved_context_node.organization_id = ${organizationId} AND resolved_context_node.id = context_identity.id`;
}
