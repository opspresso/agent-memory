CREATE TYPE "public"."knowledge_ontology_mode" AS ENUM('off', 'warn', 'strict');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ontology_mode" "knowledge_ontology_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ontology" jsonb DEFAULT '{"nodeKinds":[],"edgePredicates":[]}'::jsonb NOT NULL;