// A structured graph can require thousands of output tokens on a local model.
// Extraction and verification together remain within the 15-minute job lease.
export const knowledgeRequestTimeoutMilliseconds = 180_000;
