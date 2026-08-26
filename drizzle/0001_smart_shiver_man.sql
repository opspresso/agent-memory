ALTER TABLE "document_chunks" DROP CONSTRAINT "document_chunks_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_source_node_id_knowledge_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_target_node_id_knowledge_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_source_memory_id_memories_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_source_chunk_id_document_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_nodes" DROP CONSTRAINT "knowledge_nodes_source_memory_id_memories_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_nodes" DROP CONSTRAINT "knowledge_nodes_source_chunk_id_document_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memory_access_grants" DROP CONSTRAINT "memory_access_grants_memory_id_memories_id_fk";
--> statement-breakpoint
ALTER TABLE "memory_access_grants" DROP CONSTRAINT "memory_access_grants_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "memory_access_grants" DROP CONSTRAINT "memory_access_grants_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memory_access_grants" DROP CONSTRAINT "memory_access_grants_granted_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memory_versions" DROP CONSTRAINT "memory_versions_memory_id_memories_id_fk";
--> statement-breakpoint
ALTER TABLE "memory_versions" DROP CONSTRAINT "memory_versions_changed_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "team_members_user_idx";--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_organization_id_id_unique" ON "document_chunks" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_organization_id_id_unique" ON "documents" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_organization_id_id_unique" ON "teams" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_nodes_organization_id_id_unique" ON "knowledge_nodes" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_organization_id_id_unique" ON "memories" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_document_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_creator_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_source_node_fk" FOREIGN KEY ("organization_id","source_node_id") REFERENCES "public"."knowledge_nodes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_target_node_fk" FOREIGN KEY ("organization_id","target_node_id") REFERENCES "public"."knowledge_nodes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_memory_fk" FOREIGN KEY ("organization_id","source_memory_id") REFERENCES "public"."memories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_chunk_fk" FOREIGN KEY ("organization_id","source_chunk_id") REFERENCES "public"."document_chunks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_organization_memory_fk" FOREIGN KEY ("organization_id","source_memory_id") REFERENCES "public"."memories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_organization_chunk_fk" FOREIGN KEY ("organization_id","source_chunk_id") REFERENCES "public"."document_chunks"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_creator_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_organization_memory_fk" FOREIGN KEY ("organization_id","memory_id") REFERENCES "public"."memories"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_organization_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_organization_granter_fk" FOREIGN KEY ("organization_id","granted_by") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_organization_memory_fk" FOREIGN KEY ("organization_id","memory_id") REFERENCES "public"."memories"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_organization_changer_fk" FOREIGN KEY ("organization_id","changed_by") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("organization_id","user_id");
