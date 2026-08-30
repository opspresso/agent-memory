import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { AgentConnect } from "./agent-connect";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin =
    process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
    (host ? `${protocol}://${host}` : "");
  return <AgentConnect origin={origin} />;
}
