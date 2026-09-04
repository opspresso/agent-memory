export interface TextRerankInput {
  readonly query: string;
  readonly documents: readonly string[];
  readonly signal?: AbortSignal;
}

export interface TextRerankerService {
  rerank(input: TextRerankInput): Promise<readonly number[]>;
}

export class TextRerankerUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TextRerankerUnavailableError";
  }
}
