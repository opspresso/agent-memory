import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
import { documentErrorResponse, publicDocument } from "@/lib/document-http";
import { documentIdSchema } from "@/lib/document-schemas";
import { retryDocumentRecord } from "@/lib/document-service";
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string; documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId, documentId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  const parsedDocumentId = documentIdSchema.safeParse(documentId);
  if (!parsedOrganizationId.success || !parsedDocumentId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
  if (!authorization.authorized) {
    return authorization.response;
  }

  try {
    const document = await retryDocumentRecord(
      authorization.access,
      parsedDocumentId.data
    );
    return Response.json(publicDocument(document), { status: 202 });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
