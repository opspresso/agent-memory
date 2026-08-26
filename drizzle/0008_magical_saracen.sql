ALTER TABLE "knowledge_candidates" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_organization_reviewer_fk" FOREIGN KEY ("organization_id","reviewed_by") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidates" ADD CONSTRAINT "knowledge_candidates_review_state_check" CHECK (("knowledge_candidates"."status" = 'pending' AND "knowledge_candidates"."reviewed_by" IS NULL AND "knowledge_candidates"."reviewed_at" IS NULL)
        OR ("knowledge_candidates"."status" IN ('accepted', 'rejected') AND "knowledge_candidates"."reviewed_by" IS NOT NULL AND "knowledge_candidates"."reviewed_at" IS NOT NULL));