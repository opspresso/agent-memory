import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { withRouteErrorBoundary } from "@/lib/route-error-boundary";

const handlers = toNextJsHandler(auth);
export const GET = withRouteErrorBoundary("GET /api/auth/[...all]", handlers.GET);
export const POST = withRouteErrorBoundary("POST /api/auth/[...all]", handlers.POST);
