import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { SearchConsole } from "../search-console";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  if (!await getSessionUser(new Headers(await headers()))) redirect("/");
  return <SearchConsole initialKind="knowledge/nodes" />;
}
