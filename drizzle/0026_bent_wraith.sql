CREATE TABLE "ingestion_receipts" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingestion_receipts_organization_id_user_id_operation_key_pk" PRIMARY KEY("organization_id","user_id","operation","key"),
	CONSTRAINT "ingestion_receipts_key_length" CHECK (length("ingestion_receipts"."key") between 1 and 256),
	CONSTRAINT "ingestion_receipts_hash_shape" CHECK ("ingestion_receipts"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ingestion_receipts_operation" CHECK ("ingestion_receipts"."operation" in ('memory.create', 'document.upload', 'document.retry'))
);
--> statement-breakpoint
ALTER TABLE "ingestion_receipts" ADD CONSTRAINT "ingestion_receipts_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;