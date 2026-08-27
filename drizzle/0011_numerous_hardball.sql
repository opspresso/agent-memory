CREATE TABLE "knowledge_node_merges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_canonical_name" text NOT NULL,
	"merged_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD COLUMN "canonical_name_key" text GENERATED ALWAYS AS (lower(regexp_replace(trim(canonical_name), '[[:space:]]+', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "knowledge_node_merges" ADD CONSTRAINT "knowledge_node_merges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_merges" ADD CONSTRAINT "knowledge_node_merges_organization_reviewer_fk" FOREIGN KEY ("organization_id","merged_by") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_node_merges_source_idx" ON "knowledge_node_merges" USING btree ("organization_id","source_node_id");--> statement-breakpoint
CREATE INDEX "knowledge_node_merges_target_idx" ON "knowledge_node_merges" USING btree ("organization_id","target_node_id");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_normalized_identity_idx" ON "knowledge_nodes" USING btree ("organization_id","scope_kind","team_id","user_id","kind","canonical_name_key");--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_non_self_check" CHECK ("knowledge_edges"."source_node_id" <> "knowledge_edges"."target_node_id");