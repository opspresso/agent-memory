export interface DocumentObjectStorage {
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface DocumentIngestionQueue {
  enqueue(organizationId: string, documentId: string): Promise<void>;
}

export interface DocumentTextExtractor {
  extract(content: Uint8Array, mimeType: string): Promise<string>;
}
