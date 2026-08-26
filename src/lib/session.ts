import { auth } from "./auth";
import { hasTrustedMutationOrigin } from "./request-security";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly image: string | null;
  readonly name: string;
}

export type AuthenticationResult =
  | Readonly<{ authenticated: true; user: SessionUser }>
  | Readonly<{ authenticated: false; response: Response }>;

export async function getSessionUser(
  headers: Headers
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email,
    image: session.user.image ?? null,
    name: session.user.name
  };
}

export async function authenticateRequest(
  request: Request
): Promise<AuthenticationResult> {
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3100";
  if (!hasTrustedMutationOrigin(request, baseURL)) {
    return {
      authenticated: false,
      response: Response.json({ error: "Invalid request origin" }, { status: 403 })
    };
  }

  const user = await getSessionUser(request.headers);
  if (!user) {
    return {
      authenticated: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 })
    };
  }

  return {
    authenticated: true,
    user
  };
}
