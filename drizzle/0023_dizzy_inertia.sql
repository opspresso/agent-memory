CREATE TABLE "ai_request_buckets" (
	"organization_id" uuid NOT NULL,
	"principal_key" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	CONSTRAINT "ai_request_buckets_organization_id_principal_key_window_started_at_pk" PRIMARY KEY("organization_id","principal_key","window_started_at"),
	CONSTRAINT "ai_request_buckets_positive_count_check" CHECK ("ai_request_buckets"."request_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_request_buckets" ADD CONSTRAINT "ai_request_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_request_buckets_window_idx" ON "ai_request_buckets" USING btree ("window_started_at");