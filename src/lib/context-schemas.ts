import { z } from "zod";

export const contextSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(10_000),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});
