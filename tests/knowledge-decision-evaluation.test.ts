import { describe, expect, it, vi } from "vitest";
import { createDecisionVerificationBenchmark } from "../evaluation/knowledge/decision-verification";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { assessKnowledgeCandidate } from "@/domain/knowledge/knowledge-curation-policy";

const input = {
  content: "Atlas is a hosted service.", documentTitle: "Fixture", existingKnowledge: [],
  quotaKey: { organizationId: "org", userId: "user" },
  graph: { entities: [{ key: "organization_guess", kind: "organization", canonicalName: "Atlas" }], relationships: [] }
};
function provider(probability = 1, mutate: (value: Record<string, unknown>) => void = () => undefined) {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(options!.body as string) as { questions: Record<string, { criteria: Record<string, string> }> };
    const answers: Record<string, unknown> = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
      const choice = key.endsWith("_kind") ? "service" : "explicit";
      const names = Object.keys(question.criteria);
      return [key, { type: "choice", choice, confidence: .98,
        probabilities: Object.fromEntries(names.map((name) => [name, name === choice ? probability : (1 - probability) / (names.length - 1)])) }];
    }));
    mutate(answers);
    return Response.json({ model: "typesafe/jev-1.13-resolved", answers });
  });
}

describe("decision verification benchmark boundary", () => {
  it("withholds a proposed kind that disagrees with independently selected source meaning", async () => {
    const request = provider();
    const result = await createDecisionVerificationBenchmark({ request, threshold: .9 }).verify(input);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body.state.items).toEqual([{ type: "entity", name: "Atlas", summary: "" }]);
    expect(result.items[0]).toMatchObject({ item: "entity:organization_guess", entityKind: "service", evidence: input.content });
    const candidate = createKnowledgeCandidate({ id: "c", scope: { organizationId: "org", kind: "organization" },
      documentId: "d", chunkId: "ch", model: "extractor", graph: input.graph, now: new Date() });
    expect(assessKnowledgeCandidate({ candidate, content: input.content, ...result, ontology: null, now: new Date() }).items[0]?.verdict).toBe("review");
  });

  it.each([[.99, "explicit"], [.6, "uncertain"]] as const)("uses the selected probability %s for abstention", async (probability, support) => {
    const result = await createDecisionVerificationBenchmark({ request: provider(probability), threshold: .9 }).verify(input);
    expect(result.items[0]?.support).toBe(support);
  });

  it.each(["missing", "extra", "unknown-choice", "out-of-range"])("rejects %s decisions instead of silently accepting incomplete verification", async (defect) => {
    const request = provider(1, (answers) => {
      if (defect === "missing") delete answers.f0_quality;
      if (defect === "extra") answers.extra = answers.f0_quality;
      if (defect === "unknown-choice") answers.f0_quality = { type: "choice", choice: "invented", probabilities: { invented: 1 }, confidence: 1 };
      if (defect === "out-of-range") answers.f0_quality = { type: "choice", choice: "explicit", probabilities: { explicit: 2 }, confidence: 1 };
    });
    await expect(createDecisionVerificationBenchmark({ request, threshold: .9 }).verify(input)).rejects.toThrow();
  });

  it("does not claim to evaluate conflict context outside the benchmark", async () => {
    const request = provider();
    await expect(createDecisionVerificationBenchmark({ request, threshold: .9 }).verify({ ...input,
      existingKnowledge: [{ name: "Atlas", kind: "service", aliases: [] }] })).rejects.toThrow("existing-knowledge conflicts");
    expect(request).not.toHaveBeenCalled();
  });

  it("propagates provider errors without exposing its response text", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-provider-sentinel", { status: 503 }));
    await expect(createDecisionVerificationBenchmark({ request, threshold: .9 }).verify(input)).rejects.toThrow("Decision HTTP 503");
  });
});
