import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { MemoryLibrary } from "./memory-library";

export const dynamic = "force-dynamic";

export default async function MemoriesPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) redirect("/");
  return <MemoryLibrary />;
}
