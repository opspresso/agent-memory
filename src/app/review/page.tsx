import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { CandidateReviewPanel } from "./candidate-review-panel";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return <CandidateReviewPanel />;
}
