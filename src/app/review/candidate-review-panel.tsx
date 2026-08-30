"use client";

import { KnowledgeCandidateReview } from "../knowledge-candidate-review";
import { useOrganization } from "../organization-context";

export function CandidateReviewPanel() {
  const { organizationId } = useOrganization();
  if (!organizationId) {
    return null;
  }
  return (
    <KnowledgeCandidateReview
      key={organizationId}
      organizationId={organizationId}
    />
  );
}
