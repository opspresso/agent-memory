import { getAllowedEmailDomains } from "./access-control";
import { database } from "./container";
import { createAuth } from "./create-auth";

const buildOnlySecret = "agent-memory-build-only-secret-000000000000";

function requiredAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret && secret.length >= 32) {
    return secret;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return buildOnlySecret;
  }
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
}

function pairedClient(prefix: "GOOGLE" | "OIDC") {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId && !clientSecret) {
    return undefined;
  }
  if (!clientId || !clientSecret) {
    throw new Error(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set together`);
  }
  return { clientId, clientSecret };
}

const google = pairedClient("GOOGLE");
const oidcClient = pairedClient("OIDC");
const oidcIssuer = process.env.OIDC_ISSUER;
const passwordEnabled = process.env.AUTH_PASSWORD === "true";
const passwordSignUpEnabled = process.env.AUTH_PASSWORD_SIGNUP === "true";

if (passwordSignUpEnabled && !passwordEnabled) {
  throw new Error("AUTH_PASSWORD must be true when AUTH_PASSWORD_SIGNUP is true");
}

if ((oidcClient && !oidcIssuer) || (!oidcClient && oidcIssuer)) {
  throw new Error(
    "OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be set together"
  );
}

export const auth = createAuth({
  allowedEmailDomains: getAllowedEmailDomains(),
  database: database.db,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3100",
  secret: requiredAuthSecret(),
  ...(passwordEnabled
    ? { emailAndPassword: { allowSignUp: passwordSignUpEnabled } }
    : {}),
  ...(google ? { google } : {}),
  ...(oidcClient && oidcIssuer
    ? {
        oidc: {
          ...oidcClient,
          issuer: oidcIssuer,
          scopes: (process.env.OIDC_SCOPES ?? "openid email profile")
            .split(/\s+/)
            .filter(Boolean)
        }
      }
    : {})
});
