import { describe, expect, it } from "vitest";

import {
  authenticationHeaders,
  hasTrustedMutationOrigin
} from "@/lib/request-security";

const baseURL = "https://memory.example.com";

describe("request origin policy", () => {
  it("allows safe methods without an Origin header", () => {
    const request = new Request(`${baseURL}/api/memories`);

    expect(hasTrustedMutationOrigin(request, baseURL)).toBe(true);
  });

  it("allows same-origin mutations", () => {
    const request = new Request(`${baseURL}/api/memories`, {
      method: "POST",
      headers: { origin: baseURL }
    });

    expect(hasTrustedMutationOrigin(request, baseURL)).toBe(true);
  });

  it("allows the configured public origin behind a proxy", () => {
    const request = new Request("http://app:3000/api/memories", {
      method: "POST",
      headers: { origin: baseURL }
    });

    expect(hasTrustedMutationOrigin(request, baseURL)).toBe(true);
  });

  it("rejects missing or foreign mutation origins", () => {
    const missingOrigin = new Request(`${baseURL}/api/memories`, {
      method: "DELETE"
    });
    const foreignOrigin = new Request(`${baseURL}/api/memories`, {
      method: "POST",
      headers: { origin: "https://attacker.example" }
    });

    expect(hasTrustedMutationOrigin(missingOrigin, baseURL)).toBe(false);
    expect(hasTrustedMutationOrigin(foreignOrigin, baseURL)).toBe(false);
  });

  it("allows bearer-authenticated mutations without an Origin header", () => {
    const request = new Request(`${baseURL}/api/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer session-token" }
    });

    expect(hasTrustedMutationOrigin(request, baseURL)).toBe(true);
  });

  it("does not let bearer requests fall back to session cookies", () => {
    const bearerRequest = new Request(`${baseURL}/api/memories`, {
      method: "POST",
      headers: {
        authorization: "Bearer session-token",
        cookie: "better-auth.session_token=cookie-token"
      }
    });
    const cookieRequest = new Request(`${baseURL}/api/memories`, {
      method: "POST",
      headers: { cookie: "better-auth.session_token=cookie-token" }
    });

    expect(authenticationHeaders(bearerRequest).get("cookie")).toBeNull();
    expect(authenticationHeaders(bearerRequest).get("authorization")).toBe(
      "Bearer session-token"
    );
    expect(authenticationHeaders(cookieRequest)).toBe(cookieRequest.headers);
  });
});
