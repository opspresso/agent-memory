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
