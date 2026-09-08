import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { documentErrorResponse, publicDocument } from "@/lib/document-http";
import { listDocumentRecords } from "@/lib/document-service";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) return authorization.response;
  const query = new URL(request.url).searchParams;
  try {
    const page = await listDocumentRecords(authorization.access, Number(query.get("limit") ?? 25), Number(query.get("offset") ?? 0));
    return Response.json({ documents: page.documents.map((document) => publicDocument(document)), count: page.documents.length, nextOffset: page.nextOffset });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
