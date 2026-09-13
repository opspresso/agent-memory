export function readKnowledgeVerificationConfiguration(environment: Readonly<Record<string,string|undefined>> = process.env) {
  const override = ["KNOWLEDGE_VERIFICATION_MODEL","KNOWLEDGE_VERIFICATION_BASE_URL","KNOWLEDGE_VERIFICATION_API_KEY"]
    .some((name) => Boolean(environment[name]?.trim()));
  const model = environment[override?"KNOWLEDGE_VERIFICATION_MODEL":"KNOWLEDGE_EXTRACTION_MODEL"]?.trim();
  const baseUrl = environment[override?"KNOWLEDGE_VERIFICATION_BASE_URL":"KNOWLEDGE_EXTRACTION_BASE_URL"]?.trim();
  if (override && (!model || !baseUrl || !environment.KNOWLEDGE_EXTRACTION_MODEL?.trim())) {
    throw new Error("KNOWLEDGE_VERIFICATION_MODEL and KNOWLEDGE_VERIFICATION_BASE_URL require an enabled extraction model and must be set together");
  }
  if (!model || !baseUrl) return undefined;
  // A different provider never inherits the extraction provider's credential.
  return { model,baseUrl,apiKey:environment[override?"KNOWLEDGE_VERIFICATION_API_KEY":"KNOWLEDGE_EXTRACTION_API_KEY"]?.trim() };
}
