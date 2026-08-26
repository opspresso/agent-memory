CREATE TABLE "knowledge_edge_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"edge_id" uuid NOT NULL,
	"memory_id" uuid,
	"chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_edge_sources_identity_unique" UNIQUE NULLS NOT DISTINCT("organization_id","edge_id","memory_id","chunk_id"),
	CONSTRAINT "knowledge_edge_sources_exactly_one_source_check" CHECK (("knowledge_edge_sources"."memory_id" IS NOT NULL) <> ("knowledge_edge_sources"."chunk_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "knowledge_node_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"memory_id" uuid,
	"chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_node_sources_identity_unique" UNIQUE NULLS NOT DISTINCT("organization_id","node_id","memory_id","chunk_id"),
	CONSTRAINT "knowledge_node_sources_exactly_one_source_check" CHECK (("knowledge_node_sources"."memory_id" IS NOT NULL) <> ("knowledge_node_sources"."chunk_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_lease_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_edges_organization_id_id_unique" ON "knowledge_edges" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "knowledge_edge_sources" ADD CONSTRAINT "knowledge_edge_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edge_sources" ADD CONSTRAINT "knowledge_edge_sources_organization_edge_fk" FOREIGN KEY ("organization_id","edge_id") REFERENCES "public"."knowledge_edges"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edge_sources" ADD CONSTRAINT "knowledge_edge_sources_organization_memory_fk" FOREIGN KEY ("organization_id","memory_id") REFERENCES "public"."memories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edge_sources" ADD CONSTRAINT "knowledge_edge_sources_organization_chunk_fk" FOREIGN KEY ("organization_id","chunk_id") REFERENCES "public"."document_chunks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_sources" ADD CONSTRAINT "knowledge_node_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_sources" ADD CONSTRAINT "knowledge_node_sources_organization_node_fk" FOREIGN KEY ("organization_id","node_id") REFERENCES "public"."knowledge_nodes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_sources" ADD CONSTRAINT "knowledge_node_sources_organization_memory_fk" FOREIGN KEY ("organization_id","memory_id") REFERENCES "public"."memories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_sources" ADD CONSTRAINT "knowledge_node_sources_organization_chunk_fk" FOREIGN KEY ("organization_id","chunk_id") REFERENCES "public"."document_chunks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_edge_sources_edge_idx" ON "knowledge_edge_sources" USING btree ("organization_id","edge_id");--> statement-breakpoint
CREATE INDEX "knowledge_edge_sources_memory_idx" ON "knowledge_edge_sources" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "knowledge_edge_sources_chunk_idx" ON "knowledge_edge_sources" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "knowledge_node_sources_node_idx" ON "knowledge_node_sources" USING btree ("organization_id","node_id");--> statement-breakpoint
CREATE INDEX "knowledge_node_sources_memory_idx" ON "knowledge_node_sources" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "knowledge_node_sources_chunk_idx" ON "knowledge_node_sources" USING btree ("chunk_id");
