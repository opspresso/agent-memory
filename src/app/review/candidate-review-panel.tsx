"use client";

import { KnowledgeCandidateReview } from "../knowledge-candidate-review";
import { useOrganization } from "../organization-context";

export function CandidateReviewPanel() {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return (
    <KnowledgeCandidateReview
      key={organizationSlug}
      organizationSlug={organizationSlug}
    />
  );
}
