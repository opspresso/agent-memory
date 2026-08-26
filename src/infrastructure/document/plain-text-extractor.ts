import type { DocumentTextExtractor } from "@/domain/document/document-services";

const supportedMimeTypes = new Set([
  "application/json",
  "application/xml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/xml"
]);

export class UnsupportedDocumentTypeError extends Error {
  constructor(mimeType: string) {
    super(`unsupported document MIME type: ${mimeType}`);
    this.name = "UnsupportedDocumentTypeError";
  }
}

export function createPlainTextExtractor(): DocumentTextExtractor {
  return {
    async extract(content, mimeType) {
      const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!supportedMimeTypes.has(normalizedMimeType)) {
        throw new UnsupportedDocumentTypeError(normalizedMimeType);
      }

      const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      if (normalizedMimeType === "application/json") {
        return JSON.stringify(JSON.parse(text), null, 2);
      }
      return text;
    }
  };
}
