import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { documentFormats, documentMimeTypes, type DocumentMimeType } from "@/domain/document/document-format";

const filenames = {
  "application/json": "sample.json",
  "application/xml": "sample.xml",
  "text/xml": "sample.xml",
  "text/csv": "sample.csv",
  "text/markdown": "sample.md",
  "text/plain": "sample.txt",
  "text/html": "sample.html",
  "application/pdf": "sample.pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "sample.docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "sample.pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sample.xlsx",
  "application/vnd.ms-excel": "sample.xls",
  "application/epub+zip": "sample.epub"
} as const satisfies Record<DocumentMimeType, string>;

export const supportedDocumentFixtures = documentMimeTypes.map((mimeType) => ({
  mimeType,
  filename: filenames[mimeType],
  textMimeType: documentFormats[mimeType].textMimeType,
  read: () => readFile(resolve("tests/fixtures/documents", filenames[mimeType]))
}));
