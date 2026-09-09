DROP INDEX "knowledge_candidates_organization_chunk_unique";--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD COLUMN "extraction_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_candidates_organization_chunk_unique" ON "knowledge_candidates" USING btree ("organization_id","chunk_id") WHERE "knowledge_candidates"."superseded_at" IS NULL;