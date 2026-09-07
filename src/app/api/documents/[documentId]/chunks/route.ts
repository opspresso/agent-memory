import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { documentIdSchema } from "@/lib/document-schemas";
import { documentErrorResponse, publicDocument } from "@/lib/document-http";
import { listDocumentChunkRecords } from "@/lib/document-service";

export async function GET(request: Request, context: { readonly params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  const parsed = documentIdSchema.safeParse(documentId);
  if (!parsed.success) return Response.json({ error: "Invalid resource ID" }, { status: 400 });
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) return authorization.response;
  const query = new URL(request.url).searchParams;
  try {
    const page = await listDocumentChunkRecords(authorization.access, parsed.data, Number(query.get("limit") ?? 25), Number(query.get("offset") ?? 0));
    return Response.json({
      document: publicDocument(page.document),
      chunks: page.chunks.map((chunk) => ({ id: chunk.id, ordinal: chunk.ordinal, content: chunk.content, metadata: chunk.metadata })),
      count: page.chunks.length,
      nextOffset: page.nextOffset
    });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
