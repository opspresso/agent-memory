import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// A document can reference enough graph resources to exceed the protocol's
// bind limit if every ID is expanded into a separate parameter.
export function inArrayParameter(column: AnyPgColumn, values: readonly string[], type: "uuid" | "text" = "uuid") {
  return sql`${column} = ANY(${sql.param([...values])}::${sql.raw(type)}[])`;
}
