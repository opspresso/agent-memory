import type { KnowledgeExtractionService } from "@/domain/knowledge/knowledge-extraction-service";
import { isKnowledgeEntityKind } from "@/domain/knowledge/knowledge-entity-eligibility";
import { groundKnowledgeGraph } from "@/domain/knowledge/knowledge-extraction-quality";
import { normalizeKnowledgeKind, normalizeKnowledgePredicate } from "@/domain/knowledge/knowledge-identity";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import { createKnowledgeStructuredClient } from "./knowledge-structured-client";
import { z } from "zod";
import { sourceEvidencePassages, resolveSourceEvidence } from "./knowledge-source-evidence";
import { buildResponseJsonSchema, extractionInstructions, normalizeLinkedEntityNames, proposedGraphSchema,
  type KnowledgeExtractionServiceConfiguration } from "./knowledge-extraction-service";

const evidenceIdsSchema = z.array(z.string()).min(1).max(20);
const identifiedEntitiesSchema = z.object({ entities: z.array(proposedGraphSchema.shape.entities.element.omit({ key:true,evidence:true }).extend({ evidenceIds:evidenceIdsSchema })).max(100) });
const identifiedRelationshipsSchema = z.object({ relationships:z.array(proposedGraphSchema.shape.relationships.element.omit({ evidence:true }).extend({ evidenceIds:evidenceIdsSchema })).max(200) });

export function createEntityFirstKnowledgeExtractionService(configuration: KnowledgeExtractionServiceConfiguration): KnowledgeExtractionService {
  const client = createKnowledgeStructuredClient(configuration);
  return {
    async extract(input) {
      if (!input.content.trim()) return { model:configuration.model.trim(),graph:{ entities:[],relationships:[] } };
      const strict = input.ontology?.mode === "strict";
      const kinds = input.ontology?.nodeKinds.filter(isKnowledgeEntityKind).map(normalizeKnowledgeKind);
      const predicates = input.ontology?.edgePredicates.map(normalizeKnowledgePredicate);
      if (strict && input.ontology!.nodeKinds.length > 0 && kinds?.length === 0) {
        return { model:configuration.model.trim(),graph:{ entities:[],relationships:[] } };
      }
      const graphSchema = buildResponseJsonSchema(strict?kinds:undefined,strict?predicates:undefined);
      const entitySchema = graphSchema.schema.properties.entities;
      const sourcePassages = sourceEvidencePassages(input.content);
      const evidenceDefinition = { type:"string",enum:sourcePassages.map((passage) => passage.id) };
      const evidenceFor = (ids: readonly string[]) => [...new Set(ids)].map((id) => resolveSourceEvidence(sourcePassages,id));
      const evidence = { ...entitySchema.items.properties.evidence,items:{ $ref:"#/$defs/sourceEvidence" } };
      const instructions = extractionInstructions(input.ontology,configuration.language??"source");
      const source = { documentTitle:input.documentTitle,documentType:input.mimeType,content:input.content,sourcePassages };
      const extracted = await client.generate(`${instructions}

This is the entity identification pass. Return {"entities":[{"canonicalName":"name copied from source","kind":"entity kind","aliases":[],"evidenceIds":["s0"],"summary":"brief source-grounded summary"}]}.
Use IDs from sourcePassages for evidenceIds. Do not write quotes or invent IDs. The server assigns entity keys; do not generate keys. Return only independently identifiable named entities. Do not output relationships in this pass.
Do not create a node for a sentence, proposition, employment, opinion, or unnamed event. Copy names from the source.
Use the complete proper name without surrounding classification words such as service, product, company, technology, 서비스, 제품, 회사, 기술, unless those words are part of the actual name. Keep the type in kind, not in canonicalName.
Do not reclassify a nickname or courtesy name as a concept to create an extra node. Put explicitly supported alternative proper names in aliases. Shared nicknames never establish that two people are the same person.
A generic title or pronoun is not an alternative proper name. Return an empty entities array when no named entities are supported.`,source,
      { name:"knowledge_entities",strict:true,schema:{ type:"object",additionalProperties:false,
        $defs:{ sourceEvidence:evidenceDefinition },
        properties:{ entities:{ ...entitySchema,items:{ ...entitySchema.items,properties:{
          canonicalName:{ type:"string",description:"The proper identifying name alone, copied from the source. For 'Orion 회사', use 'Orion' and kind organization. For 'Falcon 서비스', use 'Falcon' and kind service. Preserve complete multiword proper names and intrinsic brand words." },
          kind:entitySchema.items.properties.kind, aliases:entitySchema.items.properties.aliases,
          evidenceIds:evidence, summary:entitySchema.items.properties.summary
        },required:["canonicalName","kind","aliases","evidenceIds","summary"] } } },required:["entities"] } },input.quotaKey);
      const entities = identifiedEntitiesSchema.safeParse(extracted);
      if (!entities.success) throw new SafeOperationalError("knowledge entity extraction response is invalid",{ code:"KNOWLEDGE_EXTRACTION_ENTITIES_INVALID" });
      const grounded = groundKnowledgeGraph(input.content,normalizeLinkedEntityNames(input.content,{
        entities:entities.data.entities.map(({ evidenceIds,...entity },index) => ({ ...entity,key:`e${index}`,evidence:evidenceFor(evidenceIds) })),relationships:[] }));
      const graph = { entities:grounded.entities.filter((entity) => !strict || !kinds?.length || kinds.includes(entity.kind)),relationships:[] };
      if (graph.entities.length < 2) return { model:configuration.model.trim(),graph };
      const keys = graph.entities.map((entity) => entity.key);
      const relationshipSchema = graphSchema.schema.properties.relationships;
      const related = await client.generate(`${instructions}

This is the relationship pass. The supplied entities are the complete set of possible endpoints; never create or rename entities.
Extract a relationship only if the source establishes that exact predicate and direction between these endpoints.
Allowed predicates are permissions, not a checklist. There is NO minimum number of relationships. If none is established, return {"relationships":[]}.
Never select the nearest allowed predicate to fit an opinion, plan, hypothetical, rumor, co-mention, or negated statement.
An opinion that someone would be a suitable relative does not establish serves, joins, ownership, or family ties.
Return {"relationships":[{"sourceKey":"e0","targetKey":"e1","predicate":"precise_predicate","evidenceIds":["s0"]}]}.
Every relationship needs evidenceIds selected from the supplied sourcePassages. Select separate IDs for separated facts; do not write quotes. Preserve the source's meaning even when this leaves all entities unconnected.`,
      { ...source,entities:graph.entities },{ name:"knowledge_relationships",strict:true,schema:{ type:"object",additionalProperties:false,
        $defs:{ sourceEvidence:evidenceDefinition },
        properties:{ relationships:{ ...relationshipSchema,items:{ ...relationshipSchema.items,properties:{
          sourceKey:{ type:"string",enum:keys },targetKey:{ type:"string",enum:keys },
          predicate:relationshipSchema.items.properties.predicate,evidenceIds:evidence
        },required:["sourceKey","targetKey","predicate","evidenceIds"] } } },required:["relationships"] } },input.quotaKey);
      const relationships = identifiedRelationshipsSchema.safeParse(related);
      if (!relationships.success) throw new SafeOperationalError("knowledge relationship extraction response is invalid",{ code:"KNOWLEDGE_EXTRACTION_RELATIONSHIPS_INVALID" });
      return { model:configuration.model.trim(),graph:groundKnowledgeGraph(input.content,{ ...graph,
        relationships:relationships.data.relationships.map(({ evidenceIds,...relationship }) => ({ ...relationship,evidence:evidenceFor(evidenceIds) })).filter((relation) => !strict || !predicates?.length || predicates.includes(normalizeKnowledgePredicate(relation.predicate))) }) };
    }
  };
}
