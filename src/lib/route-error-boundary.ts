import { unstable_rethrow } from "next/navigation";
import { serializeErrorForLog } from "@/infrastructure/observability/error-details";
import { logger } from "./observability";

/** Keep database binds and provider content out of the framework's default error logger. */
export function withRouteErrorBoundary<Arguments extends unknown[]>(
  operation: string,
  handler: (...args: Arguments) => Promise<Response>
): (...args: Arguments) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      unstable_rethrow(error);
      logger.error({ operation, failure: serializeErrorForLog(error) }, "HTTP request failed");
      return Response.json({ error: "Internal server error" }, {
        status: 500, headers: { "Cache-Control": "no-store" }
      });
    }
  };
}
