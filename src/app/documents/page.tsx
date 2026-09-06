import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { DocumentLibrary } from "./document-library";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return <DocumentLibrary />;
}
