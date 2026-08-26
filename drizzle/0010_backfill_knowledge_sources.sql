INSERT INTO "knowledge_node_sources" (
  "organization_id", "node_id", "memory_id", "created_at"
)
SELECT "organization_id", "id", "source_memory_id", "created_at"
FROM "knowledge_nodes"
WHERE "source_memory_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "knowledge_node_sources" (
  "organization_id", "node_id", "chunk_id", "created_at"
)
SELECT "organization_id", "id", "source_chunk_id", "created_at"
FROM "knowledge_nodes"
WHERE "source_chunk_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "knowledge_edge_sources" (
  "organization_id", "edge_id", "memory_id", "created_at"
)
SELECT "organization_id", "id", "source_memory_id", "created_at"
FROM "knowledge_edges"
WHERE "source_memory_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "knowledge_edge_sources" (
  "organization_id", "edge_id", "chunk_id", "created_at"
)
SELECT "organization_id", "id", "source_chunk_id", "created_at"
FROM "knowledge_edges"
WHERE "source_chunk_id" IS NOT NULL
ON CONFLICT DO NOTHING;
