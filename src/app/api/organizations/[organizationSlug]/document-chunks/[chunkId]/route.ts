import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { documentIdSchema } from "@/lib/document-schemas";
import { documentErrorResponse, publicDocument } from "@/lib/document-http";
import { getDocumentChunkRecord } from "@/lib/document-service";

export async function GET(request: Request, context: { readonly params: Promise<{ organizationSlug: string; chunkId: string }> }) {
  const { organizationSlug, chunkId } = await context.params;
  const parsed = documentIdSchema.safeParse(chunkId);
  if (!parsed.success) return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  const authorization = await authorizeOrganizationRoute(request, organizationSlug);
  if (!authorization.authorized) return authorization.response;
  try {
    const { document, chunk } = await getDocumentChunkRecord(authorization.access, parsed.data);
    return Response.json({ document: publicDocument(document), chunk: { id: chunk.id, ordinal: chunk.ordinal, content: chunk.content, metadata: chunk.metadata } });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
