"use client";

import { KnowledgeCandidateReview } from "../knowledge-candidate-review";
import { useOrganization } from "../organization-context";
import { useState } from "react";
import { Tabs } from "@mantine/core";
import { KnowledgeReviewQueue } from "./knowledge-review-queue";
import { useT } from "../_i18n/provider";

export function CandidateReviewPanel() {
  const { organizationSlug } = useOrganization();
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!organizationSlug) {
    return null;
  }
  return (
    <Tabs key={organizationSlug} defaultValue="groups" keepMounted={false}>
      <Tabs.List mb="lg">
        <Tabs.Tab value="groups">{t("reviewQueue.groupTab")}</Tabs.Tab>
        <Tabs.Tab value="chunks" disabled={busy}>{t("reviewQueue.chunkTab")}</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="groups"><KnowledgeReviewQueue onBusyChange={setBusy} /></Tabs.Panel>
      <Tabs.Panel value="chunks"><KnowledgeCandidateReview organizationSlug={organizationSlug} /></Tabs.Panel>
    </Tabs>
  );
}
