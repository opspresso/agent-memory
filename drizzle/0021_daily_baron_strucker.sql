CREATE TABLE "knowledge_candidate_edges" (
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"edge_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_candidate_edges_pk" PRIMARY KEY("organization_id","candidate_id","edge_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_candidate_nodes" (
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_candidate_nodes_pk" PRIMARY KEY("organization_id","candidate_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_candidate_edges" ADD CONSTRAINT "knowledge_candidate_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate_edges" ADD CONSTRAINT "knowledge_candidate_edges_organization_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."knowledge_candidates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate_edges" ADD CONSTRAINT "knowledge_candidate_edges_organization_edge_fk" FOREIGN KEY ("organization_id","edge_id") REFERENCES "public"."knowledge_edges"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate_nodes" ADD CONSTRAINT "knowledge_candidate_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate_nodes" ADD CONSTRAINT "knowledge_candidate_nodes_organization_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."knowledge_candidates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate_nodes" ADD CONSTRAINT "knowledge_candidate_nodes_organization_node_fk" FOREIGN KEY ("organization_id","node_id") REFERENCES "public"."knowledge_nodes"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_candidate_edges_edge_idx" ON "knowledge_candidate_edges" USING btree ("organization_id","edge_id");--> statement-breakpoint
CREATE INDEX "knowledge_candidate_nodes_node_idx" ON "knowledge_candidate_nodes" USING btree ("organization_id","node_id");