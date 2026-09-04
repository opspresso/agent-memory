ALTER TABLE "organizations" DROP CONSTRAINT "organizations_default_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_team_fk" FOREIGN KEY ("id","default_team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_new_member_status_check" CHECK ("organizations"."new_member_status" IN ('active', 'pending'));