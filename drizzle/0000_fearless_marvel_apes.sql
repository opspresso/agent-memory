CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('member', 'admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('member', 'manager');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('rule', 'experience', 'decision', 'preference', 'fact');--> statement-breakpoint
CREATE TYPE "public"."memory_permission" AS ENUM('read', 'write', 'manage');--> statement-breakpoint
CREATE TYPE "public"."memory_principal_kind" AS ENUM('team', 'user');--> statement-breakpoint
CREATE TYPE "public"."memory_scope_kind" AS ENUM('organization', 'team', 'user');--> statement-breakpoint
CREATE TYPE "public"."memory_source_type" AS ENUM('agent', 'user', 'document', 'system');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_nonnegative_ordinal_check" CHECK ("document_chunks"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_kind" "memory_scope_kind" NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	"title" text NOT NULL,
	"source_uri" text,
	"object_key" text NOT NULL,
	"checksum" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_scope_owner_check" CHECK (("documents"."scope_kind" = 'organization' AND "documents"."team_id" IS NULL AND "documents"."user_id" IS NULL)
        OR ("documents"."scope_kind" = 'team' AND "documents"."team_id" IS NOT NULL AND "documents"."user_id" IS NULL)
        OR ("documents"."scope_kind" = 'user' AND "documents"."team_id" IS NULL AND "documents"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_edges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_memory_id" uuid,
	"source_chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_nodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"canonical_name" text NOT NULL,
	"summary" text,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(canonical_name, '') || ' ' || coalesce(summary, ''))) STORED NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_memory_id" uuid,
	"source_chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_kind" "memory_scope_kind" NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	"kind" "memory_kind" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED NOT NULL,
	"source_type" "memory_source_type" NOT NULL,
	"source_uri" text,
	"source_agent_id" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "memory_status" DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_scope_owner_check" CHECK (("memories"."scope_kind" = 'organization' AND "memories"."team_id" IS NULL AND "memories"."user_id" IS NULL)
        OR ("memories"."scope_kind" = 'team' AND "memories"."team_id" IS NOT NULL AND "memories"."user_id" IS NULL)
        OR ("memories"."scope_kind" = 'user' AND "memories"."team_id" IS NULL AND "memories"."user_id" IS NOT NULL)),
	CONSTRAINT "memories_expiry_check" CHECK ("memories"."expires_at" IS NULL OR "memories"."expires_at" > "memories"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "memory_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"memory_id" uuid NOT NULL,
	"principal_kind" "memory_principal_kind" NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	"permission" "memory_permission" NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_access_grants_principal_check" CHECK (("memory_access_grants"."principal_kind" = 'team' AND "memory_access_grants"."team_id" IS NOT NULL AND "memory_access_grants"."user_id" IS NULL)
        OR ("memory_access_grants"."principal_kind" = 'user' AND "memory_access_grants"."team_id" IS NULL AND "memory_access_grants"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "memory_versions" (
	"memory_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_type" "memory_source_type" NOT NULL,
	"source_uri" text,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changed_by" uuid NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_versions_memory_id_version_pk" PRIMARY KEY("memory_id","version"),
	CONSTRAINT "memory_versions_positive_version_check" CHECK ("memory_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_memory_id_memories_id_fk" FOREIGN KEY ("source_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_chunk_id_document_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_source_memory_id_memories_id_fk" FOREIGN KEY ("source_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_source_chunk_id_document_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_versions" ADD CONSTRAINT "memory_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_ordinal_unique" ON "document_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_chunks_search_idx" ON "document_chunks" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_organization_checksum_unique" ON "documents" USING btree ("organization_id","checksum");--> statement-breakpoint
CREATE INDEX "documents_scope_idx" ON "documents" USING btree ("organization_id","scope_kind","team_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_organization_slug_unique" ON "teams" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_edges_identity_unique" ON "knowledge_edges" USING btree ("organization_id","source_node_id","predicate","target_node_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_target_idx" ON "knowledge_edges" USING btree ("organization_id","target_node_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_source_memory_idx" ON "knowledge_edges" USING btree ("source_memory_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_source_chunk_idx" ON "knowledge_edges" USING btree ("source_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_nodes_identity_unique" ON "knowledge_nodes" USING btree ("organization_id","kind","canonical_name");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_search_idx" ON "knowledge_nodes" USING gin ("search");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_source_memory_idx" ON "knowledge_nodes" USING btree ("source_memory_id");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_source_chunk_idx" ON "knowledge_nodes" USING btree ("source_chunk_id");--> statement-breakpoint
CREATE INDEX "memories_scope_idx" ON "memories" USING btree ("organization_id","scope_kind","team_id","user_id");--> statement-breakpoint
CREATE INDEX "memories_search_idx" ON "memories" USING gin ("search");--> statement-breakpoint
CREATE INDEX "memories_validity_idx" ON "memories" USING btree ("organization_id","status","valid_from","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_access_grants_team_unique" ON "memory_access_grants" USING btree ("memory_id","team_id","permission") WHERE "memory_access_grants"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_access_grants_user_unique" ON "memory_access_grants" USING btree ("memory_id","user_id","permission") WHERE "memory_access_grants"."user_id" IS NOT NULL;
