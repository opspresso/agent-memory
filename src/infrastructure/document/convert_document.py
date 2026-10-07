"""Convert uploaded bytes only; stdout is a bounded JSON protocol, never diagnostics."""

import contextlib
import io
import json
import os
import resource
import sys
import zipfile

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 4096


class RejectedDocument(Exception):
    pass


class ParserUnavailable(Exception):
    pass


def restrict_process():
    # MarkItDown imports ONNX Runtime via Magika even when format detection is unused.
    # Disable native telemetry before import so it cannot create files or make network requests.
    os.environ["ORT_DISABLE_TELEMETRY"] = "1"
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    # macOS does not implement an address-space limit; the parent still bounds time and output.
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))

    def deny_network(event, _args):
        if event in ("socket.connect", "socket.getaddrinfo", "socket.bind"):
            raise PermissionError("document conversion cannot access the network")

    sys.addaudithook(deny_network)


def check_archive(content, required_entry):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ARCHIVE_ENTRIES or sum(item.file_size for item in entries) > MAX_ARCHIVE_BYTES:
            raise RejectedDocument("archive_limit")
        names = [item.filename for item in entries]
        if len(set(names)) != len(names) or any(item.flag_bits & 1 for item in entries):
            raise RejectedDocument("invalid")
        if required_entry not in names:
            raise RejectedDocument("invalid")


def convert(content, mime_type):
    from markitdown import MissingDependencyException, StreamInfo
    from markitdown.converters import (
        DocxConverter, EpubConverter, HtmlConverter, PdfConverter,
        PptxConverter, XlsConverter, XlsxConverter,
    )

    converters = {
        "text/html": (HtmlConverter, ".html", None),
        "application/pdf": (PdfConverter, ".pdf", None),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            (DocxConverter, ".docx", "word/document.xml"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            (PptxConverter, ".pptx", "ppt/presentation.xml"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            (XlsxConverter, ".xlsx", "xl/workbook.xml"),
        "application/vnd.ms-excel": (XlsConverter, ".xls", None),
        "application/epub+zip": (EpubConverter, ".epub", "META-INF/container.xml"),
    }
    if mime_type not in converters:
        raise RejectedDocument("unsupported")
    converter, extension, archive_entry = converters[mime_type]
    if archive_entry:
        check_archive(content, archive_entry)
    if extension == ".pdf" and not content.lstrip().startswith(b"%PDF-"):
        raise RejectedDocument("invalid")
    if extension == ".xls" and not content.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
        raise RejectedDocument("invalid")
    if extension == ".html":
        text = content.decode("utf-8")
        if "\0" in text:
            raise RejectedDocument("invalid")
    # Select the exact converter. General convert()/URL and plugin dispatch are deliberately absent.
    try:
        result = converter().convert(
            io.BytesIO(content), StreamInfo(mimetype=mime_type, extension=extension),
            strict=True, keep_data_uris=False,
        )
    except MissingDependencyException:
        raise ParserUnavailable() from None
    if not result.markdown.strip():
        raise RejectedDocument("no_text")
    if "\0" in result.markdown:
        raise RejectedDocument("invalid")
    return {"text": result.markdown, "mimeType": "text/markdown"}


def main():
    try:
        restrict_process()
        content = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if not content or len(content) > MAX_INPUT_BYTES:
            raise RejectedDocument("input_limit")
        # Third-party warnings/errors may contain document text. Only protocol output leaves this process.
        with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            result = convert(content, sys.argv[1])
        output = json.dumps(result, ensure_ascii=False).encode("utf-8")
        if len(output) > MAX_OUTPUT_BYTES:
            raise RejectedDocument("output_limit")
        sys.stdout.buffer.write(output)
        return 0
    except RejectedDocument as error:
        sys.stdout.write(json.dumps({"error": str(error)}))
        return 2
    except (ImportError, ParserUnavailable):
        sys.stdout.write('{"error":"unavailable"}')
        return 3
    except Exception:
        sys.stdout.write('{"error":"invalid"}')
        return 2


if __name__ == "__main__":
    sys.exit(main())
