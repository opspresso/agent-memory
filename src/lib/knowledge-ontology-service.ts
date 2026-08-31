import {
  buildRecommendKnowledgeOntologyTerms,
  buildSuggestKnowledgeOntology
} from "@/application/knowledge/recommend-ontology";

import {
  knowledgeOntologyReader,
  knowledgeOntologySuggestionService,
  knowledgeTermUsageRepository
} from "./container";

export const recommendKnowledgeOntologyTermRecords =
  buildRecommendKnowledgeOntologyTerms({
    ontologyReader: knowledgeOntologyReader,
    usageRepository: knowledgeTermUsageRepository
  });

export const suggestKnowledgeOntologyRecord = buildSuggestKnowledgeOntology({
  ontologyReader: knowledgeOntologyReader,
  usageRepository: knowledgeTermUsageRepository,
  ...(knowledgeOntologySuggestionService
    ? { suggestionService: knowledgeOntologySuggestionService }
    : {})
});
