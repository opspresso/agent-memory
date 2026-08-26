ALTER TABLE "memories" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "source_agent_id" text;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "embedding" vector;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "status" "memory_status";--> statement-breakpoint
UPDATE "memory_versions" AS versions
SET "source_agent_id" = memories."source_agent_id",
    "valid_from" = memories."valid_from",
    "expires_at" = memories."expires_at",
    "status" = CASE
      WHEN versions."version" = memories."current_version" THEN memories."status"
      ELSE 'active'::"memory_status"
    END
FROM "memories"
WHERE memories."id" = versions."memory_id"
  AND memories."organization_id" = versions."organization_id";--> statement-breakpoint
ALTER TABLE "memory_versions" ALTER COLUMN "valid_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_versions" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_embedding_pair_check" CHECK (("memories"."embedding" IS NULL) = ("memories"."embedding_model" IS NULL));--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_expiry_check" CHECK ("memory_versions"."expires_at" IS NULL OR "memory_versions"."expires_at" > "memory_versions"."valid_from");--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_embedding_pair_check" CHECK (("memory_versions"."embedding" IS NULL) = ("memory_versions"."embedding_model" IS NULL));
