import type {
  ContextSearchHit,
  ContextSearchResult
} from "./search-context";

const maximumRecallCharacters = 4_000;
const maximumHitCharacters = 1_200;

function boundedText(value: string, maximumCharacters: number): string {
  const characters = [...value];
  return characters.length > maximumCharacters
    ? `${characters.slice(0, maximumCharacters - 1).join("")}…`
    : value;
}

function recallHitText(hit: ContextSearchHit): string {
  if (hit.sourceType === "memory") {
    return `[memory] ${hit.memory.title}\n${hit.memory.content}`;
  }
  if (hit.sourceType === "document") {
    return `[document] ${hit.document.title} · chunk ${hit.chunk.ordinal + 1}\n${hit.chunk.content}`;
  }
  return `[knowledge] ${hit.node.canonicalName} (${hit.node.kind})${
    hit.node.summary ? `\n${hit.node.summary}` : ""
  }`;
}

export function contextRecallText(result: ContextSearchResult): string {
  const sections = result.hits.map((hit) =>
    boundedText(recallHitText(hit), maximumHitCharacters)
  );
  return boundedText(sections.join("\n\n"), maximumRecallCharacters);
}
