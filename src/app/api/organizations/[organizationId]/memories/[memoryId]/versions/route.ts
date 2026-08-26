import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  memoryErrorResponse,
  publicMemoryVersion
} from "@/lib/memory-http";
import {
  memoryIdSchema,
  memoryVersionQuerySchema,
  organizationIdSchema
} from "@/lib/memory-schemas";
import { listMemoryVersionRecords } from "@/lib/memory-service";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; memoryId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const params = await context.params;
  const organizationId = organizationIdSchema.safeParse(params.organizationId);
  const memoryId = memoryIdSchema.safeParse(params.memoryId);
  if (!organizationId.success || !memoryId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRequest(
    request,
    organizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }
  const url = new URL(request.url);
  const parsedQuery = memoryVersionQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    before: url.searchParams.get("before") ?? undefined
  });
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Invalid memory version query", issues: parsedQuery.error.issues },
      { status: 400 }
    );
  }
  try {
    const versions = await listMemoryVersionRecords(
      authorization.access,
      memoryId.data,
      parsedQuery.data.limit,
      parsedQuery.data.before
    );
    const nextBefore =
      versions.length === parsedQuery.data.limit
        ? versions.at(-1)?.version
        : undefined;
    return Response.json({
      versions: versions.map(publicMemoryVersion),
      ...(nextBefore ? { nextBefore } : {})
    });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
