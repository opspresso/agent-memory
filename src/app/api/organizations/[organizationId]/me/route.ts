import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import { z } from "zod";

const organizationIdSchema = z.uuid();

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return Response.json({ error: "Invalid organization ID" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }

  return Response.json({
    organizationId: authorization.access.organizationId,
    role: authorization.access.role,
    teams: authorization.access.teams,
    user: authorization.user
  });
}
