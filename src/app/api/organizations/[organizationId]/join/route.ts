import { organizationAdministrationErrorResponse } from "@/lib/organization-administration-http";
import { joinOrganizationRecord } from "@/lib/organization-administration-service";
import { organizationIdSchema } from "@/lib/memory-schemas";
import { authenticateRequest } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsed = organizationIdSchema.safeParse(organizationId);
  if (!parsed.success) {
    return Response.json({ error: "Invalid organization ID" }, { status: 400 });
  }
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  try {
    const status = await joinOrganizationRecord(
      authentication.user.id,
      parsed.data
    );
    return Response.json({ status }, { status: 201 });
  } catch (error) {
    const response = organizationAdministrationErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
