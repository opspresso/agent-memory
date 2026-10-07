import { InvalidDocumentError } from "@/domain/document/document";

export interface TextChunk {
  readonly content: string;
  readonly start: number;
  readonly end: number;
  readonly contextSpans?: readonly { readonly start: number; readonly end: number }[];
}

export interface ChunkTextOptions {
  readonly maxCharacters?: number;
  readonly overlapCharacters?: number;
}

export function chunkText(
  input: string,
  options: ChunkTextOptions = {}
): readonly TextChunk[] {
  const maxCharacters = options.maxCharacters ?? 2_000;
  const overlapCharacters = options.overlapCharacters ?? 200;
  if (
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 100 ||
    !Number.isSafeInteger(overlapCharacters) ||
    overlapCharacters < 0 ||
    overlapCharacters >= maxCharacters
  ) {
    throw new Error("invalid document chunking options");
  }

  const text = input.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start] ?? "")) {
      start += 1;
    }
    if (start >= text.length) {
      break;
    }

    const targetEnd = Math.min(start + maxCharacters, text.length);
    let end = targetEnd;
    if (targetEnd < text.length) {
      const minimumBreak = start + Math.floor(maxCharacters / 2);
      const boundaryWindow = text.slice(minimumBreak, targetEnd);
      const candidates = [
        boundaryWindow.lastIndexOf("\n\n"),
        boundaryWindow.lastIndexOf("\n"),
        boundaryWindow.lastIndexOf(" ")
      ];
      const boundary = Math.max(...candidates);
      if (boundary >= 0) {
        end = minimumBreak + boundary;
      }
    }

    const content = text.slice(start, end).trimEnd();
    const actualEnd = start + content.length;
    if (content.length > 0) {
      chunks.push({ content, start, end: actualEnd });
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(actualEnd - overlapCharacters, start + 1);
  }

  return chunks;
}

function chunkMarkdown(input: string): readonly TextChunk[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  const headings: { text: string; level: number; start: number; end: number }[] = [];
  let offset = 0;
  let fence: { marker: string; length: number } | undefined;
  for (const line of normalized.split("\n")) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const marker = delimiter[1]!;
      if (!fence) {
        // Backticks in an info string make this inline text, not a fence opener.
        if (marker[0] !== "`" || !delimiter[2]!.includes("`")) {
          fence = { marker: marker[0]!, length: marker.length };
        }
      } else if (marker[0] === fence.marker && marker.length >= fence.length && !delimiter[2]!.trim()) {
        fence = undefined;
      }
    } else if (!fence) {
      const heading = /^ {0,3}(#{1,6})[ \t]+\S.*$/.exec(line);
      if (heading) headings.push({ text: line, level: heading[1]!.length, start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  }
  if (headings.length === 0) {
    return chunkText(normalized);
  }
  const chunks: TextChunk[] = [];
  const firstHeadingOffset = headings[0]?.start ?? 0;
  if (firstHeadingOffset > 0) {
    chunks.push(...chunkText(normalized.slice(0, firstHeadingOffset)));
  }
  const ancestors: typeof headings = [];
  function isHeadingOnlyLeaf(index: number): boolean {
    const heading = headings[index]!;
    const next = headings[index + 1];
    return (next?.level ?? 0) <= heading.level &&
      !normalized.slice(heading.end, next?.start ?? normalized.length).trim();
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    while (ancestors.length && ancestors.at(-1)!.level >= heading.level) ancestors.pop();
    const parents = [...ancestors];
    ancestors.push(heading);
    const sectionStart = heading.start;
    let sectionEnd = headings[index + 1]?.start ?? normalized.length;
    // Heading-only sections provide scope to their children, not separate facts.
    if (!normalized.slice(heading.end, sectionEnd).trim() && (headings[index + 1]?.level ?? 0) > heading.level) continue;
    const firstIndex = index;
    // Pack empty sibling sections without crossing an owner or a body boundary.
    if (parents.length > 0 && isHeadingOnlyLeaf(index)) {
      while (headings[index + 1]?.level === heading.level && isHeadingOnlyLeaf(index + 1)) index += 1;
      sectionEnd = headings[index + 1]?.start ?? normalized.length;
    }
    const section = normalized.slice(sectionStart, sectionEnd).trimEnd();
    const sectionOffset = sectionStart + section.length - section.trimStart().length;
    // Siblings in a packed group are content, never ancestors of later chunks.
    const continuationContext = index > firstIndex ? parents : ancestors;
    const path = continuationContext.map((item) => item.text).join("\n");
    const headingContextBudget = 2_000 - path.length - 2;
    const repeatHeading =
      headingContextBudget >= 100 && path.length <= headingContextBudget;
    const sectionChunks = chunkText(
      section,
      repeatHeading
        ? {
            maxCharacters: headingContextBudget,
            overlapCharacters: Math.min(
              200,
              Math.floor(headingContextBudget / 10)
            )
          }
        : undefined
    );
    sectionChunks.forEach((chunk, chunkIndex) => {
      const context = repeatHeading ? (chunkIndex === 0 ? parents : continuationContext) : [];
      const prefix = context.map((item) => item.text).join("\n");
      chunks.push({
        content: prefix ? `${prefix}\n\n${chunk.content}` : chunk.content,
        start: sectionOffset + chunk.start,
        end: sectionOffset + chunk.end,
        ...(context.length ? { contextSpans: context.map(({ start, end }) => ({ start, end })) } : {})
      });
    });
  }
  return chunks;
}

function csvRecords(input: string): readonly TextChunk[] {
  const records: TextChunk[] = [];
  let start = 0;
  let quoted = false;
  function append(end: number) {
    const content = input.slice(start, end);
    if (content.trim()) records.push({ content, start, end });
  }
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "\n" && !quoted) {
      append(index);
      start = index + 1;
    }
  }
  append(input.length);
  return records;
}

function chunkCsv(input: string): readonly TextChunk[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  const records = csvRecords(normalized);
  const header = records[0];
  if (!header) {
    return [];
  }
  if (
    header.content.length > 2_000 ||
    records
      .slice(1)
      .some((record) => header.content.length + 1 + record.content.length > 2_000)
  ) {
    return chunkText(normalized);
  }
  const chunks: TextChunk[] = [];
  let rows: TextChunk[] = [];
  function appendChunk() {
    chunks.push({
      content: [header!.content, ...rows.map((row) => row.content)].join("\n"),
      start: chunks.length === 0 ? header!.start : rows[0]!.start,
      end: rows.at(-1)!.end,
      ...(chunks.length > 0 ? { contextSpans: [{ start: header!.start, end: header!.end }] } : {})
    });
  }
  for (const row of records.slice(1)) {
    const candidate = [header, ...rows, row].map((record) => record.content).join("\n");
    if (candidate.length > 2_000 && rows.length > 0) {
      appendChunk();
      rows = [];
    }
    rows.push(row);
  }
  if (rows.length > 0) {
    appendChunk();
  }
  return chunks.length > 0 ? chunks : [header];
}

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function flattenJson(value: unknown): string[] {
  const lines: string[] = [];
  const pending: Array<{ readonly path: string; readonly value: unknown }> = [
    { path: "$", value }
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length === 0) {
        lines.push(`${current.path} = []`);
      } else {
        for (let index = current.value.length - 1; index >= 0; index -= 1) {
          pending.push({
            path: `${current.path}[${index}]`,
            value: current.value[index]
          });
        }
      }
    } else if (current.value !== null && typeof current.value === "object") {
      const entries = Object.entries(current.value);
      if (entries.length === 0) {
        lines.push(`${current.path} = {}`);
      } else {
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const entry = entries[index];
          if (entry) {
            pending.push({
              path: `${current.path}${jsonPathSegment(entry[0])}`,
              value: entry[1]
            });
          }
        }
      }
    } else {
      lines.push(`${current.path} = ${JSON.stringify(current.value)}`);
    }
  }
  return lines;
}

function chunkJson(input: string): readonly TextChunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    // JSON.parse messages can include source text, which must not reach worker logs.
    throw new InvalidDocumentError("document contains invalid JSON");
  }
  const structured = flattenJson(parsed).join("\n");
  return chunkText(structured);
}

function xmlContexts(
  input: string,
  offsets: readonly number[]
): readonly (string | undefined)[] {
  const contextPrefix = "XML context: /";
  const maximumContextCharacters = 99;
  const stack: string[] = [];
  let pathCharacters = 0;
  const pattern = /<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g;
  let match = pattern.exec(input);
  return offsets.map((offset) => {
    while (
      match &&
      match.index + match[0].length <= offset
    ) {
      const token = match[0];
      const name = match[1];
      if (name) {
        if (token.startsWith("</")) {
          if (stack.at(-1) === name) {
            pathCharacters -= name.length + (stack.length > 1 ? 1 : 0);
            stack.pop();
          }
        } else if (!token.endsWith("/>")) {
          pathCharacters += name.length + (stack.length > 0 ? 1 : 0);
          stack.push(name);
        }
      }
      match = pattern.exec(input);
    }
    return stack.length > 0 &&
      contextPrefix.length + pathCharacters <= maximumContextCharacters
      ? `${contextPrefix}${stack.join("/")}`
      : undefined;
  });
}

function chunkXml(input: string): readonly TextChunk[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  const chunks = chunkText(normalized, {
    maxCharacters: 1_900,
    overlapCharacters: 200
  });
  const contexts = xmlContexts(
    normalized,
    chunks.map((chunk) => chunk.start)
  );
  return chunks.map(
    (chunk, index) => {
      const context = contexts[index];
      const contextualContent = context
        ? `${context}\n${chunk.content}`
        : chunk.content;
      return contextualContent.length <= 2_000
        ? { ...chunk, content: contextualContent }
        : chunk;
    }
  );
}

export function chunkDocumentText(
  input: string,
  mimeType: string
): readonly TextChunk[] {
  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedMimeType === "text/markdown") {
    return chunkMarkdown(input);
  }
  if (normalizedMimeType === "text/csv") {
    return chunkCsv(input);
  }
  if (normalizedMimeType === "application/json") {
    return chunkJson(input);
  }
  if (normalizedMimeType === "application/xml" || normalizedMimeType === "text/xml") {
    return chunkXml(input);
  }
  return chunkText(input);
}
