import type { DocumentTextMimeType } from "./document-format";
import type { DocumentProcessingClaim } from "./document-repository";

export interface DocumentTextPart {
  readonly content: string;
  readonly start: number;
  readonly end: number;
  readonly contextSpans?: readonly { readonly start: number; readonly end: number }[];
}

export interface DocumentProcessingCheckpoint {
  readonly mimeType: DocumentTextMimeType;
  readonly parts: readonly DocumentTextPart[];
}

export interface DocumentProcessingCheckpointRepository {
  find(claim: DocumentProcessingClaim): Promise<DocumentProcessingCheckpoint | null>;
  save(claim: DocumentProcessingClaim, checkpoint: DocumentProcessingCheckpoint): Promise<void>;
}
