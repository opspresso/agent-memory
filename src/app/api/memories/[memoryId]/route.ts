import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  memoryErrorResponse,
  parseIfMatch,
  publicMemoryForAccess,
  readJsonBody,
  versionEtag
} from "@/lib/memory-http";
import {
  memoryIdSchema,
  reviseMemorySchema
} from "@/lib/memory-schemas";
import {
  archiveMemoryRecord,
  getMemoryRecord,
  reviseMemoryRecord
} from "@/lib/memory-service";

interface RouteContext {
  readonly params: Promise<{ memoryId: string }>;
}

async function routeAccess(request: Request, context: RouteContext) {
  const params = await context.params;
  const memoryId = memoryIdSchema.safeParse(params.memoryId);
  if (!memoryId.success) {
    return {
      valid: false as const,
      response: Response.json({ error: "Invalid resource ID" }, { status: 400 })
    };
  }

  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return { valid: false as const, response: authorization.response };
  }

  return {
    valid: true as const,
    access: authorization.access,
    memoryId: memoryId.data
  };
}

export async function GET(request: Request, context: RouteContext) {
  const route = await routeAccess(request, context);
  if (!route.valid) {
    return route.response;
  }

  try {
    const memory = await getMemoryRecord(route.access, route.memoryId);
    return Response.json(publicMemoryForAccess(memory, route.access), {
      headers: { ETag: versionEtag(memory.version) }
    });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const route = await routeAccess(request, context);
  if (!route.valid) {
    return route.response;
  }
  const expectedVersion = parseIfMatch(request);
  if (expectedVersion === null) {
    return Response.json(
      { error: "A valid If-Match version is required" },
      { status: 428 }
    );
  }

  const body = await readJsonBody(request);
  if (!body.valid) {
    return body.response;
  }
  const parsed = reviseMemorySchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid memory revision", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const memory = await reviseMemoryRecord({
      access: route.access,
      memoryId: route.memoryId,
      expectedVersion,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.content !== undefined
        ? { content: parsed.data.content }
        : {}),
      ...(parsed.data.source ? { source: parsed.data.source } : {}),
      ...(parsed.data.accessGrants !== undefined
        ? { accessGrants: parsed.data.accessGrants }
        : {}),
      ...(parsed.data.expiresAt !== undefined
        ? {
            expiresAt: parsed.data.expiresAt
              ? new Date(parsed.data.expiresAt)
              : null
          }
        : {}),
      ...(parsed.data.changeReason
        ? { changeReason: parsed.data.changeReason }
        : {})
    });
    return Response.json(publicMemoryForAccess(memory, route.access), {
      headers: { ETag: versionEtag(memory.version) }
    });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const route = await routeAccess(request, context);
  if (!route.valid) {
    return route.response;
  }
  const expectedVersion = parseIfMatch(request);
  if (expectedVersion === null) {
    return Response.json(
      { error: "A valid If-Match version is required" },
      { status: 428 }
    );
  }

  const changeReason = new URL(request.url).searchParams.get("reason") ?? undefined;
  if (changeReason && changeReason.length > 1_000) {
    return Response.json(
      { error: "Change reason must not exceed 1000 characters" },
      { status: 400 }
    );
  }
  try {
    await archiveMemoryRecord(
      route.access,
      route.memoryId,
      expectedVersion,
      changeReason
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
