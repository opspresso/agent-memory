import { getTableColumns, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { documents, documentChunks, knowledgeCandidates, knowledgeNodes, memories } from "../schema";
import { scopeCoveragePredicate } from "./scope-predicates";
import type { KnowledgeCandidateAssessment } from "@/domain/knowledge/knowledge-assessment";
import { contextReferenceUuid, resolvedContextNodes } from "./knowledge-context-identity";

const contextDocument = alias(documents, "assessment_document");
const contextChunk = alias(documentChunks, "assessment_chunk");
const contextMemory = alias(memories, "assessment_memory");
const contextNode = alias(knowledgeNodes, "assessment_node");
const reference = sql`assessment_source.value`;

function sourceId(key: "memoryId" | "chunkId") {
  // Invalid or legacy JSON must remain hidden, not abort a whole candidate list.
  return contextReferenceUuid(sql`(${reference}->>${key})`);
}

/** Every dependency must still be available to the candidate's entire audience. */
export function assessmentVisibilityPredicate(assessment: SQLWrapper, now: Date): SQL {
  const sources = sql`CASE WHEN jsonb_typeof(${assessment}->'sources') = 'array' THEN ${assessment}->'sources' ELSE '[]'::jsonb END`;
  const nodes = sql`CASE WHEN jsonb_typeof(${assessment}->'contextNodeIds') = 'array' THEN ${assessment}->'contextNodeIds' ELSE '[]'::jsonb END`;
  return sql`(${sources} @> jsonb_build_array(jsonb_build_object('chunkId', ${knowledgeCandidates.chunkId}::text))
    AND jsonb_typeof(${assessment}->'contextNodeIds') = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${nodes}) AS context_node(value)
      WHERE NOT coalesce(
        (SELECT ${scopeCoveragePredicate(contextNode, documents)} FROM ${knowledgeNodes} AS assessment_node
          WHERE ${contextNode.organizationId} = ${knowledgeCandidates.organizationId}
            AND ${contextNode.id} = ${contextReferenceUuid(sql`context_node.value`)}),
        (SELECT count(*) = 1 AND bool_and(${scopeCoveragePredicate(contextNode, documents)})
          FROM (${resolvedContextNodes(knowledgeCandidates.organizationId, sql`jsonb_build_array(context_node.value)`)}) AS resolved_identity
          JOIN ${knowledgeNodes} AS assessment_node ON ${contextNode.id} = resolved_identity.id)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${sources}) AS assessment_source(value)
      WHERE NOT ((( ${reference} ? 'memoryId') <> (${reference} ? 'chunkId')) AND (
        EXISTS (SELECT 1 FROM ${memories} AS assessment_memory
          WHERE ${contextMemory.organizationId} = ${knowledgeCandidates.organizationId} AND ${contextMemory.id} = ${sourceId("memoryId")}
            AND ${contextMemory.status} = 'active' AND ${contextMemory.validFrom} <= ${now.toISOString()}::timestamptz
            AND (${contextMemory.expiresAt} IS NULL OR ${contextMemory.expiresAt} > ${now.toISOString()}::timestamptz)
            AND ${scopeCoveragePredicate(contextMemory, documents)})
        OR EXISTS (SELECT 1 FROM ${documentChunks} AS assessment_chunk JOIN ${documents} AS assessment_document
          ON ${contextDocument.organizationId} = ${contextChunk.organizationId} AND ${contextDocument.id} = ${contextChunk.documentId}
          WHERE ${contextChunk.organizationId} = ${knowledgeCandidates.organizationId} AND ${contextChunk.id} = ${sourceId("chunkId")}
            AND ${contextDocument.status} = 'ready' AND ${scopeCoveragePredicate(contextDocument, documents)})
      ))
    ))`;
}

/** Use this projection for every candidate read, including mutation responses. */
export function visibleCandidateColumns(now = new Date()) {
  const history = sql`CASE WHEN jsonb_typeof(${knowledgeCandidates.assessmentHistory}) = 'array'
    THEN ${knowledgeCandidates.assessmentHistory} ELSE '[]'::jsonb END`;
  return {
    ...getTableColumns(knowledgeCandidates),
    assessment: sql<KnowledgeCandidateAssessment | null>`CASE WHEN ${assessmentVisibilityPredicate(knowledgeCandidates.assessment, now)}
      THEN ${knowledgeCandidates.assessment} ELSE NULL END`,
    assessmentHistory: sql<readonly KnowledgeCandidateAssessment[]>`(SELECT coalesce(jsonb_agg(assessment_history.value ORDER BY assessment_history.ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(${history}) WITH ORDINALITY AS assessment_history(value, ordinal)
      WHERE ${assessmentVisibilityPredicate(sql`assessment_history.value`, now)})`
  };
}

export function hasVisibleAssessmentPredicate(now = new Date()): SQL {
  const columns = visibleCandidateColumns(now);
  return sql`(${columns.assessment} IS NOT NULL OR jsonb_array_length(${columns.assessmentHistory}) > 0)`;
}
