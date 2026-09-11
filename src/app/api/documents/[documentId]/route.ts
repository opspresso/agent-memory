import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { documentErrorResponse, publicDocument, documentScopeEtag, parseDocumentScopeEtag } from "@/lib/document-http";
import { documentIdSchema, changeDocumentScopeSchema } from "@/lib/document-schemas";
import { readJsonBody } from "@/lib/json-body";
import { resolveScopedResource } from "@/lib/scoped-resource";
import {
  archiveDocumentRecord,
  changeDocumentScopeRecord,
  getDocumentRecord
} from "@/lib/document-service";

interface RouteContext {
  readonly params: Promise<{ documentId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const parsedDocumentId = documentIdSchema.safeParse(documentId);
  if (!parsedDocumentId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }

  try {
    const document = await getDocumentRecord(authorization.access, parsedDocumentId.data);
    return Response.json(publicDocument(document), { headers: { ETag: documentScopeEtag(document), "Cache-Control": "no-store" } });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const parsedId = documentIdSchema.safeParse(documentId);
  if (!parsedId.success) return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) return authorization.response;
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch) return Response.json({ error: "If-Match is required" }, { status: 428 });
  const expectedUpdatedAt = parseDocumentScopeEtag(ifMatch);
  if (!expectedUpdatedAt) return Response.json({ error: "Invalid If-Match" }, { status: 400 });
  const body = await readJsonBody(request, 4096);
  if (!body.valid) return body.response;
  const parsed = changeDocumentScopeSchema.safeParse(body.value);
  if (!parsed.success) return Response.json({ error: "Invalid document scope", issues: parsed.error.issues }, { status: 400 });
  try {
    const result = await changeDocumentScopeRecord({
      access: authorization.access, documentId: parsedId.data, expectedUpdatedAt,
      scope: resolveScopedResource(parsed.data.scope, authorization.access.organizationId, authorization.access.userId)
    });
    return Response.json({ document: publicDocument(result.document), knowledge: result.knowledge }, { headers: { ETag: documentScopeEtag(result.document), "Cache-Control": "no-store" } });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const parsedDocumentId = documentIdSchema.safeParse(documentId);
  if (!parsedDocumentId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }
  try {
    await archiveDocumentRecord(
      authorization.access,
      parsedDocumentId.data
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
