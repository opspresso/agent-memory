import { describe, expect, it } from "vitest";

import {
  createKnowledgeOntology,
  defaultKnowledgeOntology,
  defaultKnowledgeOntologyMode,
  emptyKnowledgeOntology,
  enforceKnowledgeOntology,
  evaluateKnowledgeOntology,
  InvalidKnowledgeOntologyError,
  KnowledgeOntologyViolationError
} from "@/domain/knowledge/knowledge-ontology";

describe("knowledge ontology", () => {
  it("ships an already normalized default dictionary with warn mode", () => {
    expect(defaultKnowledgeOntologyMode).toBe("warn");
    expect(createKnowledgeOntology(defaultKnowledgeOntology)).toEqual(
      defaultKnowledgeOntology
    );
    expect(defaultKnowledgeOntology.nodeKinds).toContain("service");
    expect(defaultKnowledgeOntology.edgePredicates).toContain("depends_on");
  });

  it("normalizes, aliases, and dedupes dictionary terms", () => {
    expect(
      createKnowledgeOntology({
        nodeKinds: [" Service ", "SERVICE", "Award"],
        edgePredicates: [" DEPENDS_ON ", "depends_on", "Owns"]
      })
    ).toEqual({
      nodeKinds: ["service", "recognition"],
      edgePredicates: ["depends_on", "owns"]
    });
  });

  it("rejects empty and oversized terms", () => {
    expect(() =>
      createKnowledgeOntology({ nodeKinds: ["  "], edgePredicates: [] })
    ).toThrow(InvalidKnowledgeOntologyError);
    expect(() =>
      createKnowledgeOntology({
        nodeKinds: [],
        edgePredicates: ["a".repeat(101)]
      })
    ).toThrow(InvalidKnowledgeOntologyError);
  });

  it("rejects dictionaries above the term limit", () => {
    expect(() =>
      createKnowledgeOntology({
        nodeKinds: Array.from({ length: 201 }, (_, index) => `kind-${index}`),
        edgePredicates: []
      })
    ).toThrow(InvalidKnowledgeOntologyError);
  });

  it("leaves an axis unconstrained when its list is empty", () => {
    const ontology = createKnowledgeOntology({
      nodeKinds: ["service"],
      edgePredicates: []
    });
    expect(
      evaluateKnowledgeOntology(ontology, {
        kinds: ["service"],
        predicates: ["anything_goes"]
      })
    ).toEqual([]);
    expect(evaluateKnowledgeOntology(emptyKnowledgeOntology, {
      kinds: ["gadget"],
      predicates: ["loves"]
    })).toEqual([]);
  });

  it("matches terms after normalization and aliasing", () => {
    const ontology = createKnowledgeOntology({
      nodeKinds: ["recognition"],
      edgePredicates: ["depends_on"]
    });
    expect(
      evaluateKnowledgeOntology(ontology, {
        kinds: [" Award "],
        predicates: [" DEPENDS_ON "]
      })
    ).toEqual([]);
  });

  it("dedupes violations by type and term", () => {
    const ontology = createKnowledgeOntology({
      nodeKinds: ["service"],
      edgePredicates: ["depends_on"]
    });
    expect(
      evaluateKnowledgeOntology(ontology, {
        kinds: ["gadget", "Gadget"],
        predicates: ["loves", "loves"]
      })
    ).toEqual([
      { type: "unknown_kind", term: "gadget" },
      { type: "unknown_predicate", term: "loves" }
    ]);
  });

  it("enforces off, warn, and strict modes", () => {
    const violations = [{ type: "unknown_kind" as const, term: "gadget" }];
    expect(enforceKnowledgeOntology("off", violations)).toEqual([]);
    expect(enforceKnowledgeOntology("warn", violations)).toEqual(violations);
    expect(enforceKnowledgeOntology("strict", [])).toEqual([]);
    expect(() => enforceKnowledgeOntology("strict", violations)).toThrow(
      KnowledgeOntologyViolationError
    );
  });
});
