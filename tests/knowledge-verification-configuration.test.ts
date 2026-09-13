import { describe, expect, it } from "vitest";
import { readKnowledgeVerificationConfiguration } from "@/lib/knowledge-verification-configuration";
import { validateRuntimeEnvironment } from "@/lib/runtime-configuration";

const extraction = { KNOWLEDGE_EXTRACTION_MODEL:"extractor",KNOWLEDGE_EXTRACTION_BASE_URL:"http://extractor.test/v1",KNOWLEDGE_EXTRACTION_API_KEY:"extractor-key" };
describe("independent verification configuration", () => {
  it("uses the extraction model only when no verifier override is configured", () => {
    expect(readKnowledgeVerificationConfiguration({})).toBeUndefined();
    expect(readKnowledgeVerificationConfiguration(extraction)).toEqual({ model:"extractor",baseUrl:"http://extractor.test/v1",apiKey:"extractor-key" });
  });
  it("never forwards the extraction credential to a separate verification provider", () => {
    const override = { ...extraction,KNOWLEDGE_VERIFICATION_MODEL:"verifier",KNOWLEDGE_VERIFICATION_BASE_URL:"http://verifier.test/v1" };
    expect(readKnowledgeVerificationConfiguration(override)).toEqual({ model:"verifier",baseUrl:"http://verifier.test/v1",apiKey:undefined });
    expect(readKnowledgeVerificationConfiguration({ ...override,KNOWLEDGE_VERIFICATION_API_KEY:"verifier-key" })?.apiKey).toBe("verifier-key");
  });
  it("rejects incomplete overrides and invalid endpoints before applying runtime settings", () => {
    for (const override of [{ KNOWLEDGE_VERIFICATION_MODEL:"verifier" },{ KNOWLEDGE_VERIFICATION_API_KEY:"key" },
      { KNOWLEDGE_VERIFICATION_MODEL:"verifier",KNOWLEDGE_VERIFICATION_BASE_URL:"https://user:secret@verifier.test" }]) {
      expect(() => validateRuntimeEnvironment({ AUTH_PASSWORD:"true",...extraction,...override })).toThrow();
    }
  });
});
