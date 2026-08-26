DROP INDEX "memory_access_grants_team_unique";--> statement-breakpoint
DROP INDEX "memory_access_grants_user_unique";--> statement-breakpoint
ALTER TABLE "memory_versions" ADD COLUMN "access_grants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
WITH ranked_grants AS (
	SELECT "id",
		row_number() OVER (
			PARTITION BY "memory_id", "principal_kind", coalesce("team_id", "user_id")
			ORDER BY CASE "permission"
				WHEN 'manage' THEN 3
				WHEN 'write' THEN 2
				ELSE 1
			END DESC, "created_at" DESC, "id" DESC
		) AS "rank"
	FROM "memory_access_grants"
)
DELETE FROM "memory_access_grants"
USING ranked_grants
WHERE "memory_access_grants"."id" = ranked_grants."id"
	AND ranked_grants."rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_access_grants_team_unique" ON "memory_access_grants" USING btree ("memory_id","team_id") WHERE "memory_access_grants"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_access_grants_user_unique" ON "memory_access_grants" USING btree ("memory_id","user_id") WHERE "memory_access_grants"."user_id" IS NOT NULL;
