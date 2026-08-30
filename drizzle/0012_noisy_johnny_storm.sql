CREATE TYPE "public"."organization_member_status" AS ENUM('active', 'pending', 'blocked');--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "status" "organization_member_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "new_member_status" "organization_member_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_team_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_team_id_teams_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;