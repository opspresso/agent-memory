import { organizationAdministrationErrorResponse } from "@/lib/organization-administration-http";
import { organizationSlugSchema } from "@/lib/organization-administration-schemas";
import { joinOrganizationRecord } from "@/lib/organization-administration-service";
import { authenticateRequest } from "@/lib/session";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const parsed = organizationSlugSchema.safeParse(organizationSlug);
  if (!parsed.success) {
    return Response.json({ error: "Invalid organization slug" }, { status: 400 });
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
