DROP INDEX "documents_organization_checksum_unique";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "size_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "documents_organization_checksum_idx" ON "documents" USING btree ("organization_id","checksum");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_embedding_pair_check" CHECK (("document_chunks"."embedding" IS NULL) = ("document_chunks"."embedding_model" IS NULL));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_nonnegative_size_check" CHECK ("documents"."size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_nonnegative_attempts_check" CHECK ("documents"."processing_attempts" >= 0);