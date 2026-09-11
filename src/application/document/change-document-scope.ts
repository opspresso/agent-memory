import type { DocumentScopeChangeRepository, ChangeDocumentScopeInput } from "@/domain/document/document-scope-change";
import { canAccessScopedResource } from "@/domain/identity/organization-access";
import { InvalidDocumentError } from "@/domain/document/document";
import { DocumentAccessDeniedError } from "./upload-document";
import { DocumentNotFoundError } from "./get-document";

export class DocumentScopeConflictError extends Error {
  constructor() { super("Document changed; reload it before changing scope"); this.name = "DocumentScopeConflictError"; }
}
export class DocumentScopeNotReadyError extends Error {
  constructor() { super("Only ready documents can change scope"); this.name = "DocumentScopeNotReadyError"; }
}
export class DocumentRelatedScopeConflictError extends Error {
  constructor() {
    super("Related knowledge would remain outside the document scope; resolve its sharing conflicts before restricting this document");
    this.name = "DocumentRelatedScopeConflictError";
  }
}

export function buildChangeDocumentScope(dependencies: { readonly repository: DocumentScopeChangeRepository; readonly clock: () => Date }) {
  return async (input: Omit<ChangeDocumentScopeInput, "now">) => {
    if (!canAccessScopedResource(input.access, "manage", input.scope)) throw new DocumentAccessDeniedError();
    const result = await dependencies.repository.changeScope({ ...input, now: dependencies.clock() });
    if (result.status === "changed") return result;
    if (result.status === "not_found") throw new DocumentNotFoundError();
    if (result.status === "access_denied") throw new DocumentAccessDeniedError();
    if (result.status === "conflict") throw new DocumentScopeConflictError();
    if (result.status === "not_ready") throw new DocumentScopeNotReadyError();
    if (result.status === "related_scope_conflict") throw new DocumentRelatedScopeConflictError();
    throw new InvalidDocumentError("Target scope does not exist in this organization");
  };
}
