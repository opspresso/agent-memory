import { listJoinableOrganizationRecords } from "@/lib/organization-administration-service";
import { authenticateRequest } from "@/lib/session";

export async function GET(request: Request) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  const organizations = await listJoinableOrganizationRecords(
    authentication.user.id
  );
  return Response.json({ organizations, count: organizations.length });
}
