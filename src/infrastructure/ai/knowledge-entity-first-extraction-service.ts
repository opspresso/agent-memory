import type { KnowledgeExtractionService } from "@/domain/knowledge/knowledge-extraction-service";
import { isKnowledgeEntityKind } from "@/domain/knowledge/knowledge-entity-eligibility";
import { groundKnowledgeGraph } from "@/domain/knowledge/knowledge-extraction-quality";
import { normalizeKnowledgeKind, normalizeKnowledgePredicate } from "@/domain/knowledge/knowledge-identity";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import { createKnowledgeStructuredClient } from "./knowledge-structured-client";
import { buildResponseJsonSchema, extractionInstructions, normalizeLinkedEntityNames, proposedGraphSchema,
  type KnowledgeExtractionServiceConfiguration } from "./knowledge-extraction-service";

export function createEntityFirstKnowledgeExtractionService(configuration: KnowledgeExtractionServiceConfiguration): KnowledgeExtractionService {
  const client = createKnowledgeStructuredClient(configuration);
  return {
    async extract(input) {
      const strict = input.ontology?.mode === "strict";
      const kinds = input.ontology?.nodeKinds.filter(isKnowledgeEntityKind).map(normalizeKnowledgeKind);
      const predicates = input.ontology?.edgePredicates.map(normalizeKnowledgePredicate);
      if (strict && input.ontology!.nodeKinds.length > 0 && kinds?.length === 0) {
        return { model:configuration.model.trim(),graph:{ entities:[],relationships:[] } };
      }
      const graphSchema = buildResponseJsonSchema(strict?kinds:undefined,strict?predicates:undefined);
      const entitySchema = graphSchema.schema.properties.entities;
      const instructions = extractionInstructions(input.ontology,configuration.language??"source");
      const source = { documentTitle:input.documentTitle,documentType:input.mimeType,content:input.content };
      const extracted = await client.generate(`${instructions}

This is the entity identification pass. Return only independently identifiable named entities. Do not output relationships in this pass.
Do not create a node for a sentence, proposition, employment, opinion, or unnamed event. Copy names from the source.
Use the complete proper name without surrounding classification words such as service, product, company, technology, 서비스, 제품, 회사, 기술, unless those words are part of the actual name. Keep the type in kind, not in canonicalName.
Do not reclassify a nickname or courtesy name as a concept to create an extra node. Put explicitly supported alternative proper names in aliases. Shared nicknames never establish that two people are the same person.
A generic title or pronoun is not an alternative proper name. Return an empty entities array when no named entities are supported.`,source,
      { name:"knowledge_entities",strict:true,schema:{ type:"object",additionalProperties:false,
        properties:{ entities:{ ...entitySchema,items:{ ...entitySchema.items,properties:{ ...entitySchema.items.properties,
          canonicalName:{ type:"string",description:"The proper identifying name alone, copied from the source. For 'Orion 회사', use 'Orion' and kind organization. For 'Falcon 서비스', use 'Falcon' and kind service. Preserve complete multiword proper names and intrinsic brand words." }
        } } } },required:["entities"] } },input.quotaKey);
      const entities = proposedGraphSchema.pick({ entities:true }).safeParse(extracted);
      if (!entities.success) throw new SafeOperationalError("knowledge entity extraction response is invalid",{ code:"KNOWLEDGE_EXTRACTION_ENTITIES_INVALID" });
      const grounded = groundKnowledgeGraph(input.content,normalizeLinkedEntityNames(input.content,{ entities:entities.data.entities,relationships:[] }));
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
Every relationship needs its own verbatim supporting quote. Preserve the source's meaning even when this leaves all entities unconnected.`,
      { ...source,entities:graph.entities },{ name:"knowledge_relationships",strict:true,schema:{ type:"object",additionalProperties:false,
        properties:{ relationships:{ ...relationshipSchema,items:{ ...relationshipSchema.items,properties:{ ...relationshipSchema.items.properties,
          sourceKey:{ type:"string",enum:keys },targetKey:{ type:"string",enum:keys } } } } },required:["relationships"] } },input.quotaKey);
      const relationships = proposedGraphSchema.pick({ relationships:true }).safeParse(related);
      if (!relationships.success) throw new SafeOperationalError("knowledge relationship extraction response is invalid",{ code:"KNOWLEDGE_EXTRACTION_RELATIONSHIPS_INVALID" });
      return { model:configuration.model.trim(),graph:groundKnowledgeGraph(input.content,{ ...graph,
        relationships:relationships.data.relationships.filter((relation) => !strict || !predicates?.length || predicates.includes(normalizeKnowledgePredicate(relation.predicate))) }) };
    }
  };
}
