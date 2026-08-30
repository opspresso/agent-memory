import {
  normalizeKnowledgeKind,
  normalizeKnowledgePredicate
} from "./knowledge-identity";

export const knowledgeOntologyModes = ["off", "warn", "strict"] as const;

export type KnowledgeOntologyMode = (typeof knowledgeOntologyModes)[number];

export interface KnowledgeOntology {
  readonly nodeKinds: readonly string[];
  readonly edgePredicates: readonly string[];
}

export const emptyKnowledgeOntology: KnowledgeOntology = Object.freeze({
  nodeKinds: Object.freeze([]) as readonly string[],
  edgePredicates: Object.freeze([]) as readonly string[]
});

export interface KnowledgeOntologyViolation {
  readonly type: "unknown_kind" | "unknown_predicate";
  readonly term: string;
}

export class InvalidKnowledgeOntologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeOntologyError";
  }
}

export class KnowledgeOntologyViolationError extends Error {
  readonly violations: readonly KnowledgeOntologyViolation[];

  constructor(violations: readonly KnowledgeOntologyViolation[]) {
    const terms = violations.map((violation) => violation.term).join(", ");
    super(`knowledge ontology violation: ${terms}`);
    this.name = "KnowledgeOntologyViolationError";
    this.violations = violations;
  }
}

const TERM_LIMIT = 200;
const TERM_MAX_LENGTH = 100;

function normalizedTerms(
  values: readonly string[],
  label: string,
  normalize: (value: string) => string
): readonly string[] {
  if (values.length > TERM_LIMIT) {
    throw new InvalidKnowledgeOntologyError(
      `${label} must contain at most ${TERM_LIMIT} terms`
    );
  }
  const terms = new Set<string>();
  for (const value of values) {
    const term = normalize(value);
    if (term.length === 0 || term.length > TERM_MAX_LENGTH) {
      throw new InvalidKnowledgeOntologyError(
        `${label} terms must contain between 1 and ${TERM_MAX_LENGTH} characters`
      );
    }
    terms.add(term);
  }
  return Object.freeze([...terms]);
}

export function createKnowledgeOntology(input: {
  readonly nodeKinds: readonly string[];
  readonly edgePredicates: readonly string[];
}): KnowledgeOntology {
  return Object.freeze({
    nodeKinds: normalizedTerms(
      input.nodeKinds,
      "ontology node kinds",
      normalizeKnowledgeKind
    ),
    edgePredicates: normalizedTerms(
      input.edgePredicates,
      "ontology edge predicates",
      normalizeKnowledgePredicate
    )
  });
}

export function evaluateKnowledgeOntology(
  ontology: KnowledgeOntology,
  terms: {
    readonly kinds?: readonly string[];
    readonly predicates?: readonly string[];
  }
): readonly KnowledgeOntologyViolation[] {
  const violations = new Map<string, KnowledgeOntologyViolation>();
  if (ontology.nodeKinds.length > 0) {
    const allowed = new Set(ontology.nodeKinds);
    for (const kind of terms.kinds ?? []) {
      const term = normalizeKnowledgeKind(kind);
      if (!allowed.has(term)) {
        violations.set(`unknown_kind:${term}`, { type: "unknown_kind", term });
      }
    }
  }
  if (ontology.edgePredicates.length > 0) {
    const allowed = new Set(ontology.edgePredicates);
    for (const predicate of terms.predicates ?? []) {
      const term = normalizeKnowledgePredicate(predicate);
      if (!allowed.has(term)) {
        violations.set(`unknown_predicate:${term}`, {
          type: "unknown_predicate",
          term
        });
      }
    }
  }
  return [...violations.values()];
}

export function enforceKnowledgeOntology(
  mode: KnowledgeOntologyMode,
  violations: readonly KnowledgeOntologyViolation[]
): readonly KnowledgeOntologyViolation[] {
  if (mode === "off") {
    return [];
  }
  if (mode === "strict" && violations.length > 0) {
    throw new KnowledgeOntologyViolationError(violations);
  }
  return violations;
}
