ALTER TABLE "documents" DROP CONSTRAINT "documents_organization_creator_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_candidates" DROP CONSTRAINT "knowledge_candidates_organization_reviewer_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_node_merges" DROP CONSTRAINT "knowledge_node_merges_organization_reviewer_fk";
--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_organization_creator_fk";
--> statement-breakpoint
ALTER TABLE "memory_access_grants" DROP CONSTRAINT "memory_access_grants_organization_granter_fk";
--> statement-breakpoint
ALTER TABLE "memory_versions" DROP CONSTRAINT "memory_versions_organization_changer_fk";
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_node_merges" ADD CONSTRAINT "knowledge_node_merges_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;