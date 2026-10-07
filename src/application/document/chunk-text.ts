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

function* markdownLines(input: string) {
  let offset = 0;
  let fence: { marker: string; length: number } | undefined;
  for (const line of input.split("\n")) {
    let isCode = Boolean(fence);
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const marker = delimiter[1]!;
      if (!fence) {
        // Backticks in an info string make this inline text, not a fence opener.
        if (marker[0] !== "`" || !delimiter[2]!.includes("`")) {
          fence = { marker: marker[0]!, length: marker.length };
          isCode = true;
        }
      } else if (marker[0] === fence.marker && marker.length >= fence.length && !delimiter[2]!.trim()) {
        fence = undefined;
      }
    }
    yield { content: line, start: offset, end: offset + line.length, isCode };
    offset += line.length + 1;
  }
}

function tableCells(line: string): readonly string[] | undefined {
  const cells: string[] = [];
  let start = 0;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "|" && !escaped) {
      cells.push(line.slice(start, index).trim());
      start = index + 1;
    }
    escaped = character === "\\" && !escaped;
  }
  if (cells.length === 0) return undefined;
  cells.push(line.slice(start).trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function chunkRecords(header: TextChunk, rows: readonly TextChunk[], maximumCharacters: number): readonly TextChunk[] {
  const chunks: TextChunk[] = [];
  const rowBudget = maximumCharacters - header.content.length - 1;
  let pending: TextChunk[] = [];
  let length = header.content.length;
  function append(records: readonly TextChunk[], includeHeaderInSpan: boolean) {
    chunks.push({
      content: [header.content, ...records.map((row) => row.content)].join("\n"),
      start: includeHeaderInSpan ? header.start : records[0]!.start,
      end: records.at(-1)!.end,
      ...(!includeHeaderInSpan ? { contextSpans: [{ start: header.start, end: header.end }] } : {})
    });
  }
  function flush() {
    if (pending.length) append(pending, chunks.length === 0);
    pending = [];
    length = header.content.length;
  }
  for (const row of rows) {
    if (length + row.content.length + 1 > maximumCharacters) flush();
    if (row.content.length > rowBudget) {
      const offset = row.start + row.content.length - row.content.trimStart().length;
      for (const part of chunkText(row.content, {
        maxCharacters: rowBudget,
        overlapCharacters: Math.min(200, Math.floor(rowBudget / 10))
      })) append([{ ...part, start: offset + part.start, end: offset + part.end }], false);
    } else {
      pending.push(row);
      length += row.content.length + 1;
    }
  }
  flush();
  return chunks.length ? chunks : [header];
}

function chunkMarkdownBlocks(input: string, options: ChunkTextOptions = {}, omitHeadingOnlyPrefix = false): readonly TextChunk[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  if (!normalized.includes("|")) return chunkText(normalized, options);
  const lines = [...markdownLines(normalized)];
  const chunks: TextChunk[] = [];
  let proseStart = 0;
  function appendProse(end: number, beforeTable = false) {
    const prose = normalized.slice(proseStart, end);
    const headingOnly = beforeTable && omitHeadingOnlyPrefix && prose.trim().split("\n")
      .every((line) => !line.trim() || /^ {0,3}#{1,6}[ \t]+\S/.test(line));
    if (headingOnly) return;
    const offset = proseStart + prose.length - prose.trimStart().length;
    for (const chunk of chunkText(prose, options)) {
      chunks.push({ ...chunk, start: offset + chunk.start, end: offset + chunk.end });
    }
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    const first = lines[index]!;
    const separator = lines[index + 1]!;
    if (first.isCode || separator.isCode || /^(?: {4}| {0,3}\t)/.test(first.content)) continue;
    const headerCells = tableCells(first.content);
    const separatorCells = tableCells(separator.content);
    if (!headerCells?.length || headerCells.length !== separatorCells?.length ||
        !separatorCells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const header = { content: normalized.slice(first.start, separator.end), start: first.start, end: separator.end };
    const maximumCharacters = options.maxCharacters ?? 2_000;
    // A header must leave room for a useful row fragment within the chunk budget.
    if (header.content.length + 101 > maximumCharacters) continue;
    let end = index + 2;
    while (end < lines.length && !lines[end]!.isCode && tableCells(lines[end]!.content)) end += 1;
    appendProse(first.start, true);
    chunks.push(...chunkRecords(header, lines.slice(index + 2, end), maximumCharacters));
    proseStart = lines[end - 1]!.end;
    index = end - 1;
  }
  appendProse(normalized.length);
  return chunks;
}

function chunkMarkdown(input: string): readonly TextChunk[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  const headings: { text: string; level: number; start: number; end: number }[] = [];
  for (const line of markdownLines(normalized)) {
    const heading = !line.isCode && /^ {0,3}(#{1,6})[ \t]+\S.*$/.exec(line.content);
    if (heading) headings.push({ text: line.content, level: heading[1]!.length, start: line.start, end: line.end });
  }
  if (headings.length === 0) {
    return chunkMarkdownBlocks(normalized);
  }
  const chunks: TextChunk[] = [];
  const firstHeadingOffset = headings[0]?.start ?? 0;
  if (firstHeadingOffset > 0) {
    chunks.push(...chunkMarkdownBlocks(normalized.slice(0, firstHeadingOffset)));
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
    const sectionChunks = chunkMarkdownBlocks(
      section,
      repeatHeading
        ? {
            maxCharacters: headingContextBudget,
            overlapCharacters: Math.min(
              200,
              Math.floor(headingContextBudget / 10)
            )
          }
        : undefined,
      repeatHeading
    );
    sectionChunks.forEach((chunk) => {
      const context = repeatHeading ? (chunk.start === 0 ? parents : continuationContext) : [];
      const prefix = context.map((item) => item.text).join("\n");
      const contextSpans = [
        ...context.map(({ start, end }) => ({ start, end })),
        ...(chunk.contextSpans ?? []).map(({ start, end }) => ({ start: sectionOffset + start, end: sectionOffset + end }))
      ];
      chunks.push({
        content: prefix ? `${prefix}\n\n${chunk.content}` : chunk.content,
        start: sectionOffset + chunk.start,
        end: sectionOffset + chunk.end,
        ...(contextSpans.length ? { contextSpans } : {})
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
  if (header.content.length + 101 > 2_000) {
    return chunkText(normalized);
  }
  return chunkRecords(header, records.slice(1), 2_000);
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
