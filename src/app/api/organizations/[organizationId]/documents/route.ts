import { authorizeOrganizationRequest } from "@/lib/organization-authorization";
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
import { organizationIdSchema } from "@/lib/memory-schemas";

interface RouteContext {
  readonly params: Promise<{ organizationId: string }>;
}

function textField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return Response.json({ error: "Invalid organization ID" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
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

  const scope =
    parsed.data.scopeKind === "organization"
      ? {
          kind: "organization" as const,
          organizationId: parsedOrganizationId.data
        }
      : parsed.data.scopeKind === "team"
        ? {
            kind: "team" as const,
            organizationId: parsedOrganizationId.data,
            teamId: parsed.data.teamId!
          }
        : {
            kind: "user" as const,
            organizationId: parsedOrganizationId.data,
            userId: parsed.data.userId ?? authorization.user.id
          };

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
        Location: `/api/organizations/${organizationId}/documents/${document.id}`
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

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return Response.json({ error: "Invalid organization ID" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationRequest(
    request,
    parsedOrganizationId.data
  );
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
      total: hits.length
    });
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}
