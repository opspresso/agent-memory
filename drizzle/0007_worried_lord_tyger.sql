CREATE TYPE "public"."knowledge_candidate_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "knowledge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"model" text NOT NULL,
	"graph" jsonb NOT NULL,
	"status" "knowledge_candidate_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_organization_document_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_organization_document_id_unique" ON "document_chunks" USING btree ("organization_id","document_id","id");--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_document_chunk_fk" FOREIGN KEY ("organization_id","document_id","chunk_id") REFERENCES "public"."document_chunks"("organization_id","document_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_candidates_organization_chunk_unique" ON "knowledge_candidates" USING btree ("organization_id","chunk_id");--> statement-breakpoint
CREATE INDEX "knowledge_candidates_review_queue_idx" ON "knowledge_candidates" USING btree ("organization_id","status","created_at");
