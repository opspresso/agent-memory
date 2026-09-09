import type { Pool } from "pg";

export function readSchemaArtifact(): { readonly sql: string; readonly hash: string };
export function initializeSchema(pool: Pool): Promise<void>;
