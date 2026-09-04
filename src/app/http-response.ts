import { z } from "zod";

const errorResponseSchema = z.object({
  error: z.string().min(1).optional(),
  message: z.string().min(1).optional()
});

function responseErrorMessage(body: unknown, fallback: string): string {
  const error = errorResponseSchema.safeParse(body);
  return error.success
    ? error.data.message ?? error.data.error ?? fallback
    : fallback;
}

export async function responseJson<T>(
  response: Response,
  fallback: string,
  schema: z.ZodType<T>
): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, fallback));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(fallback);
  }
  return parsed.data;
}

export async function responseOk(
  response: Response,
  fallback: string
): Promise<void> {
  if (response.ok) {
    return;
  }
  const body: unknown = await response.json().catch(() => null);
  throw new Error(responseErrorMessage(body, fallback));
}
