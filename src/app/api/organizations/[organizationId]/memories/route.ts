import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import {
  memoryErrorResponse,
  publicMemoryForAccess,
  readJsonBody,
  versionEtag
} from "@/lib/memory-http";
import {
  createMemorySchema,
  organizationIdSchema
} from "@/lib/memory-schemas";
import {
  createMemoryRecord,
  searchMemoryRecords
} from "@/lib/memory-service";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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

  const body = await readJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = createMemorySchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid memory", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const scope =
    parsed.data.scope.kind === "organization"
      ? { kind: "organization" as const, organizationId: parsedOrganizationId.data }
      : parsed.data.scope.kind === "team"
        ? {
            kind: "team" as const,
            organizationId: parsedOrganizationId.data,
            teamId: parsed.data.scope.teamId
          }
        : {
            kind: "user" as const,
            organizationId: parsedOrganizationId.data,
            userId: parsed.data.scope.userId ?? authorization.user.id
          };

  try {
    const memory = await createMemoryRecord({
      access: authorization.access,
      kind: parsed.data.kind,
      scope,
      title: parsed.data.title,
      content: parsed.data.content,
      source: parsed.data.source,
      ...(parsed.data.accessGrants !== undefined
        ? { accessGrants: parsed.data.accessGrants }
        : {}),
      ...(parsed.data.validFrom
        ? { validFrom: new Date(parsed.data.validFrom) }
        : {}),
      ...(parsed.data.expiresAt
        ? { expiresAt: new Date(parsed.data.expiresAt) }
        : {})
    });

    return Response.json(publicMemoryForAccess(memory, authorization.access), {
      status: 201,
      headers: {
        ETag: versionEtag(memory.version),
        Location: `/api/organizations/${organizationId}/memories/${memory.id}`
      }
    });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
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

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 10 : Number(rawLimit);
  try {
    const hits = await searchMemoryRecords(authorization.access, query, limit);
    return Response.json({
      hits: hits.map((hit) => ({
        ...hit,
        memory: publicMemoryForAccess(hit.memory, authorization.access)
      })),
      total: hits.length
    });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
