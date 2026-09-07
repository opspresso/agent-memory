import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import { memoryErrorResponse, publicMemoryForAccess } from "@/lib/memory-http";
import { listMemoryRecords } from "@/lib/memory-service";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) return authorization.response;
  const query = new URL(request.url).searchParams;
  try {
    const page = await listMemoryRecords(authorization.access, Number(query.get("limit") ?? 25), Number(query.get("offset") ?? 0));
    return Response.json({ memories: page.memories.map((memory) => publicMemoryForAccess(memory, authorization.access)), count: page.memories.length, nextOffset: page.nextOffset });
  } catch (error) {
    const response = memoryErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
