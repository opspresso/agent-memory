import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer, genericOAuth } from "better-auth/plugins";

import type { AgentMemoryDatabase } from "@/infrastructure/database/client";
import {
  authAccounts,
  authSessions,
  authVerifications,
  users
} from "@/infrastructure/database/schema";

interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

interface OidcClient extends OAuthClient {
  readonly issuer: string;
  readonly scopes: readonly string[];
}

export interface CreateAuthOptions {
  readonly baseURL: string;
  readonly database: AgentMemoryDatabase;
  readonly secret: string;
  readonly emailAndPassword?: Readonly<{
    allowSignUp: boolean;
  }>;
  readonly google?: OAuthClient;
  readonly includeNextCookies?: boolean;
  readonly oidc?: OidcClient;
}

export function createAuth(options: CreateAuthOptions) {
  const oidc = options.oidc;

  return betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications
      },
      transaction: true
    }),
    advanced: {
      database: {
        generateId: "uuid"
      }
    },
    ...(options.emailAndPassword
      ? {
          emailAndPassword: {
            enabled: true,
            disableSignUp: !options.emailAndPassword.allowSignUp
          }
        }
      : {}),
    ...(options.google
      ? { socialProviders: { google: options.google } }
      : {}),
    plugins: [
      bearer(),
      ...(options.includeNextCookies === false ? [] : [nextCookies()]),
      ...(oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "oidc",
                  discoveryUrl: `${oidc.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret,
                  scopes: [...oidc.scopes],
                  pkce: true
                }
              ]
            })
          ]
        : [])
    ]
  });
}
