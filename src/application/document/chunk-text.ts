export interface TextChunk {
  readonly content: string;
  readonly start: number;
  readonly end: number;
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
      const candidates = [
        text.lastIndexOf("\n\n", targetEnd),
        text.lastIndexOf("\n", targetEnd),
        text.lastIndexOf(" ", targetEnd)
      ];
      const boundary = Math.max(...candidates.filter((value) => value >= minimumBreak));
      if (boundary >= minimumBreak) {
        end = boundary;
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
  const headings = [...normalized.matchAll(/^#{1,6}\s+.+$/gm)];
  if (headings.length === 0) {
    return chunkText(normalized);
  }
  const chunks: TextChunk[] = [];
  const firstHeadingOffset = headings[0]?.index ?? 0;
  if (firstHeadingOffset > 0) {
    chunks.push(...chunkText(normalized.slice(0, firstHeadingOffset)));
  }
  headings.forEach((match, index) => {
    const sectionStart = match.index;
    const sectionEnd = headings[index + 1]?.index ?? normalized.length;
    const heading = match[0].trim();
    const section = normalized.slice(sectionStart, sectionEnd).trimEnd();
    const headingContextBudget = 2_000 - heading.length - 2;
    const repeatHeading = headingContextBudget >= 100;
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
      chunks.push({
        content:
          chunkIndex === 0 || !repeatHeading
            ? chunk.content
            : `${heading}\n\n${chunk.content}`,
        start: sectionStart + chunk.start,
        end: sectionStart + chunk.end
      });
    });
  });
  return chunks;
}

function csvRecords(input: string): readonly string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "\n" && !quoted) {
      records.push(input.slice(start, index).replace(/\r$/, ""));
      start = index + 1;
    }
  }
  records.push(input.slice(start).replace(/\r$/, ""));
  return records.filter((record) => record.trim().length > 0);
}

function chunkCsv(input: string): readonly TextChunk[] {
  const records = csvRecords(input);
  const header = records[0];
  if (!header) {
    return [];
  }
  if (
    header.length > 2_000 ||
    records
      .slice(1)
      .some((record) => header.length + 1 + record.length > 2_000)
  ) {
    return chunkText(input);
  }
  const chunks: TextChunk[] = [];
  let rows: string[] = [];
  let offset = header.length + 1;
  let chunkStart = 0;
  for (const row of records.slice(1)) {
    const candidate = [header, ...rows, row].join("\n");
    if (candidate.length > 2_000 && rows.length > 0) {
      const content = [header, ...rows].join("\n");
      chunks.push({ content, start: chunkStart, end: offset - 1 });
      rows = [];
      chunkStart = offset;
    }
    rows.push(row);
    offset += row.length + 1;
  }
  if (rows.length > 0) {
    chunks.push({ content: [header, ...rows].join("\n"), start: chunkStart, end: input.length });
  }
  return chunks.length > 0 ? chunks : [{ content: header, start: 0, end: header.length }];
}

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function flattenJson(value: unknown, path = "$", lines: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${path} = []`);
    } else {
      value.forEach((item, index) => flattenJson(item, `${path}[${index}]`, lines));
    }
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      lines.push(`${path} = {}`);
    } else {
      entries.forEach(([key, item]) =>
        flattenJson(item, `${path}${jsonPathSegment(key)}`, lines)
      );
    }
  } else {
    lines.push(`${path} = ${JSON.stringify(value)}`);
  }
  return lines;
}

function chunkJson(input: string): readonly TextChunk[] {
  const structured = flattenJson(JSON.parse(input)).join("\n");
  return chunkText(structured);
}

function activeXmlPath(input: string, offset: number): string | undefined {
  const stack: string[] = [];
  const prefix = input.slice(0, offset);
  for (const match of prefix.matchAll(/<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g)) {
    const token = match[0];
    const name = match[1]!;
    if (token.startsWith("</")) {
      if (stack.at(-1) === name) {
        stack.pop();
      }
    } else if (!token.endsWith("/>")) {
      stack.push(name);
    }
  }
  return stack.length > 0 ? `XML context: /${stack.join("/")}` : undefined;
}

function chunkXml(input: string): readonly TextChunk[] {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  return chunkText(normalized, { maxCharacters: 1_900, overlapCharacters: 200 }).map(
    (chunk) => {
      const context = activeXmlPath(normalized, chunk.start);
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
