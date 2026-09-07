import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { documentErrorResponse, publicDocument } from "@/lib/document-http";
import { documentIdSchema } from "@/lib/document-schemas";
import {
  archiveDocumentRecord,
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
    return Response.json(
      publicDocument(
        await getDocumentRecord(authorization.access, parsedDocumentId.data)
      )
    );
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
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
