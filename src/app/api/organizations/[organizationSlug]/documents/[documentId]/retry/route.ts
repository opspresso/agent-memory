import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { documentErrorResponse, publicDocument } from "@/lib/document-http";
import { documentIdSchema } from "@/lib/document-schemas";
import { retryDocumentRecord } from "@/lib/document-service";

interface RouteContext {
  readonly params: Promise<{ organizationSlug: string; documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationSlug, documentId } = await context.params;
  const parsedDocumentId = documentIdSchema.safeParse(documentId);
  if (!parsedDocumentId.success) {
    return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationRoute(
    request,
    organizationSlug
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
