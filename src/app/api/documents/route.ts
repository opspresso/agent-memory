import { authorizeOrganizationRoute } from "@/lib/organization-authorization";
import {
  boundedFormData,
  DocumentUploadTooLargeError,
  documentErrorResponse,
  maxDocumentBytes,
  parseMetadata,
  publicDocument,
  publicDocumentHit
} from "@/lib/document-http";
import { documentUploadFieldsSchema } from "@/lib/document-schemas";
import {
  searchDocumentRecords,
  uploadDocumentRecord
} from "@/lib/document-service";
import { resolveScopedResource } from "@/lib/scoped-resource";

function textField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRoute(request);
  if (!authorization.authorized) {
    return authorization.response;
  }

  let formData: FormData;
  try {
    formData = await boundedFormData(request);
  } catch (error) {
    if (error instanceof DocumentUploadTooLargeError) {
      return Response.json(
        { error: "Document upload is too large" },
        { status: 413 }
      );
    }
    return Response.json(
      { error: "Invalid multipart form data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "A non-empty document file is required" },
      { status: 400 }
    );
  }
  if (file.size > maxDocumentBytes) {
    return Response.json({ error: "Document upload is too large" }, { status: 413 });
  }

  const metadata = parseMetadata(formData.get("metadata"));
  if (!metadata.valid) {
    return Response.json(
      { error: "Document metadata must be a JSON object" },
      { status: 400 }
    );
  }
  const mimeType = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const parsed = documentUploadFieldsSchema.safeParse({
    scopeKind: formData.get("scopeKind"),
    teamId: textField(formData, "teamId"),
    userId: textField(formData, "userId"),
    title: textField(formData, "title") ?? file.name,
    sourceUri: textField(formData, "sourceUri"),
    mimeType,
    metadata: metadata.value
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid document upload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const scope = resolveScopedResource(
    parsed.data.scopeKind === "organization"
      ? { kind: "organization" }
      : parsed.data.scopeKind === "team"
        ? { kind: "team", teamId: parsed.data.teamId! }
        : { kind: "user", userId: parsed.data.userId },
    authorization.access.organizationId,
    authorization.user.id
  );

  try {
    const document = await uploadDocumentRecord({
      access: authorization.access,
      scope,
      title: parsed.data.title,
      ...(parsed.data.sourceUri ? { sourceUri: parsed.data.sourceUri } : {}),
      mimeType: parsed.data.mimeType,
      content: new Uint8Array(await file.arrayBuffer()),
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {})
    });
    return Response.json(publicDocument(document), {
      status: 202,
      headers: {
        Location: `/api/documents/${document.id}`
      }
    });
  } catch (error) {
    const response = documentErrorResponse(error);
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
    const hits = await searchDocumentRecords(
      authorization.access,
      query,
      limit
    );
    return Response.json({
      hits: hits.map(publicDocumentHit),
      count: hits.length
    });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
