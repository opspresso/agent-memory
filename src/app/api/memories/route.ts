import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  memoryErrorResponse,
  publicMemoryForAccess,
  readJsonBody,
  versionEtag
} from "@/lib/memory-http";
import { createMemorySchema } from "@/lib/memory-schemas";
import {
  createMemoryRecord,
  searchMemoryRecords
} from "@/lib/memory-service";
import { resolveScopedResource } from "@/lib/scoped-resource";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
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

  const scope = resolveScopedResource(
    parsed.data.scope,
    authorization.access.organizationId,
    authorization.user.id
  );

  try {
    const memory = await createMemoryRecord({
      ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
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
        Location: `/api/memories/${memory.id}`
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

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
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
      count: hits.length
    });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
