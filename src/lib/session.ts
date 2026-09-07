import { isAdminEmail } from "./access-control";
import { auth } from "./auth";
import {
  authenticationHeaders,
  hasTrustedMutationOrigin
} from "./request-security";
import { getEffectiveAdminEmails } from "./runtime-settings";

export interface SessionUser {
  readonly email: string;
  readonly id: string;
  readonly image: string | null;
  readonly isAdmin: boolean;
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
    email: session.user.email,
    id: session.user.id,
    image: session.user.image ?? null,
    isAdmin: isAdminEmail(
      session.user.email,
      await getEffectiveAdminEmails()
    ),
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

  const user = await getSessionUser(authenticationHeaders(request));
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
