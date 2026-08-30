import { publicContextSearchResult } from "@/lib/context-http";
import { contextSearchQuerySchema } from "@/lib/context-schemas";
import { searchContextRecords } from "@/lib/context-service";
import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { aiErrorResponse } from "@/lib/ai-http";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationRoute(
    request,
    organizationId
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  const url = new URL(request.url);
  const parsedQuery = contextSearchQuerySchema.safeParse({
    query: url.searchParams.get("q") ?? "",
    limit: url.searchParams.get("limit") ?? undefined
  });
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Invalid context search", issues: parsedQuery.error.issues },
      { status: 400 }
    );
  }
  try {
    const result = await searchContextRecords(
      authorization.access,
      parsedQuery.data.query,
      parsedQuery.data.limit
    );
    return Response.json(
      publicContextSearchResult(
        result,
        parsedQuery.data.limit,
        authorization.access
      )
    );
  } catch (error) {
    const response = aiErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
