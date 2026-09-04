import type { DocumentUploadLimits } from "@/domain/document/document-repository";

const defaultDocumentUploadLimits: DocumentUploadLimits = {
  maximumOrganizationStorageBytes: 1_073_741_824,
  maximumPendingDocuments: 100,
  maximumUserUploadsPerHour: 100
};

function positiveSafeInteger(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number
): number {
  const raw = environment[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

export function readDocumentUploadLimits(
  environment: Readonly<Record<string, string | undefined>> = process.env
): DocumentUploadLimits {
  return {
    maximumOrganizationStorageBytes: positiveSafeInteger(
      environment,
      "DOCUMENT_STORAGE_QUOTA_BYTES",
      defaultDocumentUploadLimits.maximumOrganizationStorageBytes
    ),
    maximumPendingDocuments: positiveSafeInteger(
      environment,
      "DOCUMENT_PENDING_QUOTA",
      defaultDocumentUploadLimits.maximumPendingDocuments
    ),
    maximumUserUploadsPerHour: positiveSafeInteger(
      environment,
      "DOCUMENT_UPLOADS_PER_USER_PER_HOUR",
      defaultDocumentUploadLimits.maximumUserUploadsPerHour
    )
  };
}
