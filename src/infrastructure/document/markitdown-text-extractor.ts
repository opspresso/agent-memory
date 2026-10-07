import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { InvalidDocumentError } from "@/domain/document/document";
import { documentFormats, isDocumentMimeType, isDocumentTextMimeType } from "@/domain/document/document-format";
import type { DocumentTextExtractor, ExtractedDocumentText } from "@/domain/document/document-services";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

import { createPlainTextExtractor } from "./plain-text-extractor";

const maximumOutputBytes = 8 * 1_024 * 1_024;
const conversionTimeoutMilliseconds = 60_000;
const conversionErrors: Readonly<Record<string, string>> = {
  unsupported: "unsupported document MIME type",
  invalid: "document is damaged, encrypted, or does not match its file type",
  no_text: "document contains no extractable text; scanned images require OCR before upload",
  input_limit: "document must contain between 1 byte and 10 MiB",
  archive_limit: "document archive exceeds 64 MiB or 4096 entries",
  output_limit: "converted document exceeds the 8 MiB output limit"
};

interface MarkItDownOptions {
  readonly pythonPath: string;
  readonly scriptPath?: string;
  readonly timeoutMilliseconds?: number;
}

export function createMarkItDownTextExtractor(options: MarkItDownOptions): DocumentTextExtractor {
  const plainTextExtractor = createPlainTextExtractor();
  const scriptPath = options.scriptPath ?? resolve("src/infrastructure/document/convert_document.py");
  return {
    async extract(content, mimeType) {
      const normalized = mimeType.split(";", 1)[0]!.trim().toLowerCase();
      if (!isDocumentMimeType(normalized)) throw new InvalidDocumentError("unsupported document MIME type");
      if (isDocumentTextMimeType(normalized)) return plainTextExtractor.extract(content, normalized);
      const outputMimeType = documentFormats[normalized].textMimeType;
      return new Promise<ExtractedDocumentText>((resolveResult, reject) => {
        const child = spawn(options.pythonPath, ["-I", scriptPath, normalized], {
          shell: false,
          stdio: ["pipe", "pipe", "ignore"],
          env: { NODE_ENV: "production", PATH: process.env.PATH, LANG: "C.UTF-8", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" }
        });
        const output: Buffer[] = [];
        let outputBytes = 0;
        let failure: Error | undefined;
        let inputFailed = false;
        const stop = (error: Error) => {
          failure ??= error;
          child.kill("SIGKILL");
        };
        const timeout = setTimeout(() => stop(new InvalidDocumentError("document conversion exceeded its time limit")),
          options.timeoutMilliseconds ?? conversionTimeoutMilliseconds);
        child.on("error", () => {
          failure ??= new SafeOperationalError("document parser could not start; check DOCUMENT_PARSER_PYTHON and parser dependencies", { code: "DOCUMENT_PARSER_UNAVAILABLE" });
        });
        child.stdin.on("error", () => {
          // Preserve an early rejection, but never accept a successful conversion of partial input.
          inputFailed = true;
        });
        child.stdout.on("data", (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > maximumOutputBytes) stop(new InvalidDocumentError(conversionErrors.output_limit!));
          else if (!failure) output.push(chunk);
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (failure) return reject(failure);
          if (inputFailed && code === 0) {
            return reject(new SafeOperationalError("document parser could not read the complete input", { code: "DOCUMENT_PARSER_INPUT_ERROR" }));
          }
          let response: unknown;
          try {
            response = JSON.parse(Buffer.concat(output).toString("utf8"));
          } catch {
            return reject(new SafeOperationalError("document parser returned an invalid response", { code: "DOCUMENT_PARSER_PROTOCOL_ERROR" }));
          }
          if (response && typeof response === "object") {
            if (code === 0 && "text" in response && typeof response.text === "string" &&
                "mimeType" in response && response.mimeType === outputMimeType) {
              return resolveResult({ text: response.text, mimeType: response.mimeType });
            }
            if (code === 2 && "error" in response && typeof response.error === "string" &&
                Object.hasOwn(conversionErrors, response.error)) {
              return reject(new InvalidDocumentError(conversionErrors[response.error]!));
            }
          }
          reject(new SafeOperationalError("document parser failed; check parser dependencies and resource limits", { code: "DOCUMENT_PARSER_FAILED" }));
        });
        child.stdin.end(content);
      });
    }
  };
}
