export const documentTextMimeTypes = [
  "application/json", "application/xml", "text/csv", "text/markdown", "text/plain", "text/xml"
] as const;

export type DocumentTextMimeType = (typeof documentTextMimeTypes)[number];

export const documentFormats = {
  "application/json": { extensions: [".json"], textMimeType: "application/json", parser: "native" },
  "application/xml": { extensions: [".xml"], textMimeType: "application/xml", parser: "native" },
  "text/xml": { extensions: [], textMimeType: "text/xml", parser: "native" },
  "text/csv": { extensions: [".csv"], textMimeType: "text/csv", parser: "native" },
  "text/markdown": { extensions: [".md", ".markdown"], textMimeType: "text/markdown", parser: "native" },
  "text/plain": { extensions: [".txt"], textMimeType: "text/plain", parser: "native" },
  "text/html": { extensions: [".html", ".htm"], textMimeType: "text/markdown", parser: "markitdown" },
  "application/pdf": { extensions: [".pdf"], textMimeType: "text/markdown", parser: "markitdown" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extensions: [".docx"], textMimeType: "text/markdown", parser: "markitdown"
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    extensions: [".pptx"], textMimeType: "text/markdown", parser: "markitdown"
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extensions: [".xlsx"], textMimeType: "text/markdown", parser: "markitdown"
  },
  "application/vnd.ms-excel": { extensions: [".xls"], textMimeType: "text/markdown", parser: "markitdown" },
  "application/epub+zip": { extensions: [".epub"], textMimeType: "text/markdown", parser: "markitdown" }
} as const satisfies Record<string, {
  readonly extensions: readonly string[];
  readonly textMimeType: DocumentTextMimeType;
  readonly parser: "native" | "markitdown";
}>;

export type DocumentMimeType = keyof typeof documentFormats;
export const documentMimeTypes = Object.keys(documentFormats) as [DocumentMimeType, ...DocumentMimeType[]];
export const documentFileAccept = Object.entries(documentFormats)
  .flatMap(([mimeType, format]) => [...format.extensions, mimeType]).join(",");

export function isDocumentMimeType(value: string): value is DocumentMimeType {
  return Object.hasOwn(documentFormats, value);
}

export function isDocumentTextMimeType(value: string): value is DocumentTextMimeType {
  return documentTextMimeTypes.some((mimeType) => mimeType === value);
}

// Browsers can send empty/generic types, or text/plain for Markdown and CSV.
// An explicit supported type takes precedence unless it conflicts with a known extension.
export function resolveDocumentMimeType(filename: string, declaredType: string): DocumentMimeType | undefined {
  const mimeType = declaredType.split(";", 1)[0]!.trim().toLowerCase();
  const extension = /\.[^.\\/]+$/.exec(filename)?.[0]?.toLowerCase();
  const extensionType = documentMimeTypes.find((type) =>
    (documentFormats[type].extensions as readonly string[]).includes(extension ?? ""));
  if (mimeType === "" || mimeType === "application/octet-stream" || mimeType === "application/zip") {
    return extensionType;
  }
  if (mimeType === "text/plain" && extensionType &&
      (isDocumentTextMimeType(extensionType) || extensionType === "text/html")) return extensionType;
  const canonical = mimeType === "application/xhtml+xml" ? "text/html"
    : mimeType === "application/x-pdf" ? "application/pdf"
      : mimeType === "text/x-markdown" ? "text/markdown" : mimeType;
  if (!isDocumentMimeType(canonical)) return undefined;
  if (extensionType && canonical !== extensionType &&
      !(canonical === "text/xml" && extensionType === "application/xml")) return undefined;
  return canonical;
}
