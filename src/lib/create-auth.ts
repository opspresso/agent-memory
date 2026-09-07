import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { bearer, genericOAuth } from "better-auth/plugins";

import type { AgentMemoryDatabase } from "@/infrastructure/database/client";
import {
  authAccounts,
  authSessions,
  authVerifications,
  users
} from "@/infrastructure/database/schema";
import { authenticationLogger } from "@/infrastructure/observability/logger";

import { isAllowedEmailDomain } from "./access-control";

interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

interface OidcClient extends OAuthClient {
  readonly issuer: string;
  readonly scopes: readonly string[];
}

export interface CreateAuthOptions {
  readonly allowedEmailDomains?: readonly string[];
  readonly getAllowedEmailDomains?: () => Promise<readonly string[]>;
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
  const allowedEmailDomains = options.allowedEmailDomains ?? [];

  async function assertAllowedEmailDomain(email: string): Promise<void> {
    const domains = options.getAllowedEmailDomains
      ? await options.getAllowedEmailDomains()
      : allowedEmailDomains;
    if (!isAllowedEmailDomain(email, domains)) {
      throw new APIError("FORBIDDEN", {
        code: "EMAIL_DOMAIN_NOT_ALLOWED",
        message: "Email domain is not allowed"
      });
    }
  }

  return betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    logger: authenticationLogger,
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
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            await assertAllowedEmailDomain(user.email);
            return { data: user };
          }
        }
      },
      session: {
        create: {
          before: async (session, context) => {
            const user = await context?.context.internalAdapter.findUserById(
              session.userId
            );
            if (user) {
              await assertAllowedEmailDomain(user.email);
            }
            return { data: session };
          }
        }
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
