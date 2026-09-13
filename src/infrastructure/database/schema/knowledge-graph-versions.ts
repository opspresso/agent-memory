import { sql } from "drizzle-orm";
import { pgTable, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./identity";

// A transaction changes this token whenever it may change graph topology.
// Random revisions also invalidate a projection after a PostgreSQL restore/reset.
export const knowledgeGraphVersions = pgTable("knowledge_graph_versions", {
  organizationId: uuid().primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  revision: uuid().notNull().default(sql`uuidv7()`)
});
