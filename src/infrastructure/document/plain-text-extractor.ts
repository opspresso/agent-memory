import type { DocumentTextExtractor } from "@/domain/document/document-services";
import { InvalidDocumentError } from "@/domain/document/document";
import { isDocumentTextMimeType } from "@/domain/document/document-format";

export function createPlainTextExtractor(): DocumentTextExtractor {
  return {
    async extract(content, mimeType) {
      const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!isDocumentTextMimeType(normalizedMimeType)) {
        throw new InvalidDocumentError("unsupported document MIME type");
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        throw new InvalidDocumentError("document must contain valid UTF-8 text");
      }
      if (text.includes("\0")) throw new InvalidDocumentError("document contains binary data");
      return { text, mimeType: normalizedMimeType };
    }
  };
}
