ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_organization_memory_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_organization_chunk_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_nodes" DROP CONSTRAINT "knowledge_nodes_organization_memory_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_nodes" DROP CONSTRAINT "knowledge_nodes_organization_chunk_fk";
--> statement-breakpoint
DROP INDEX "knowledge_edges_source_memory_idx";--> statement-breakpoint
DROP INDEX "knowledge_edges_source_chunk_idx";--> statement-breakpoint
DROP INDEX "knowledge_nodes_source_memory_idx";--> statement-breakpoint
DROP INDEX "knowledge_nodes_source_chunk_idx";--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP COLUMN "source_memory_id";--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP COLUMN "source_chunk_id";--> statement-breakpoint
ALTER TABLE "knowledge_nodes" DROP COLUMN "source_memory_id";--> statement-breakpoint
ALTER TABLE "knowledge_nodes" DROP COLUMN "source_chunk_id";