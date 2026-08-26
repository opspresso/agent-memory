DROP INDEX "knowledge_edges_identity_unique";--> statement-breakpoint
DROP INDEX "knowledge_nodes_identity_unique";--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "scope_kind" "memory_scope_kind" DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD COLUMN "scope_kind" "memory_scope_kind" DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_organization_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_identity_unique" UNIQUE NULLS NOT DISTINCT("organization_id","scope_kind","team_id","user_id","source_node_id","predicate","target_node_id");--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_identity_unique" UNIQUE NULLS NOT DISTINCT("organization_id","scope_kind","team_id","user_id","kind","canonical_name");--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_scope_owner_check" CHECK (("knowledge_edges"."scope_kind" = 'organization' AND "knowledge_edges"."team_id" IS NULL AND "knowledge_edges"."user_id" IS NULL)
        OR ("knowledge_edges"."scope_kind" = 'team' AND "knowledge_edges"."team_id" IS NOT NULL AND "knowledge_edges"."user_id" IS NULL)
        OR ("knowledge_edges"."scope_kind" = 'user' AND "knowledge_edges"."team_id" IS NULL AND "knowledge_edges"."user_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_scope_owner_check" CHECK (("knowledge_nodes"."scope_kind" = 'organization' AND "knowledge_nodes"."team_id" IS NULL AND "knowledge_nodes"."user_id" IS NULL)
        OR ("knowledge_nodes"."scope_kind" = 'team' AND "knowledge_nodes"."team_id" IS NOT NULL AND "knowledge_nodes"."user_id" IS NULL)
        OR ("knowledge_nodes"."scope_kind" = 'user' AND "knowledge_nodes"."team_id" IS NULL AND "knowledge_nodes"."user_id" IS NOT NULL));--> statement-breakpoint
UPDATE "knowledge_nodes"
SET "embedding" = NULL, "embedding_model" = NULL
WHERE ("embedding" IS NULL) <> ("embedding_model" IS NULL);--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_embedding_pair_check" CHECK (("knowledge_nodes"."embedding" IS NULL) = ("knowledge_nodes"."embedding_model" IS NULL));
