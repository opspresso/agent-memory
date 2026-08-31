import { describe, expect, it } from "vitest";

import {
  OrganizationAgentTokenAccessDeniedError,
  OrganizationAgentTokenNotRevealableError,
  createOrganizationAgentTokenUseCases
} from "@/application/identity/manage-organization-agent-token";
import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";
import type {
  OrganizationAgentToken,
  OrganizationAgentTokenRepository,
  OrganizationAgentTokenSecret
} from "@/domain/identity/organization-agent-token-repository";
import { createOrganizationAgentTokenSecret } from "@/infrastructure/security/organization-agent-token-secret";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-31T00:00:00.000Z");

function access(role: "member" | "admin" | "owner" = "admin") {
  return { organizationId, userId, role, teams: [] } as const;
}

function dependencies() {
  let stored: OrganizationAgentToken | null = null;
  let generated = 0;
  let active = true;
  const repository: OrganizationAgentTokenRepository = {
    async findByOrganizationId(candidateOrganizationId) {
      return stored?.organizationId === candidateOrganizationId ? stored : null;
    },
    async findByOrganizationSlug(organizationSlug) {
      return organizationSlug === "opspresso" ? stored : null;
    },
    async save(token) {
      stored = token;
    },
    async delete(candidateOrganizationId) {
      if (stored?.organizationId === candidateOrganizationId) {
        stored = null;
      }
    }
  };
  const accessRepository: OrganizationAccessRepository = {
    async listByUser() {
      return [];
    },
    async findByUser(candidateOrganizationId, candidateUserId) {
      return active && candidateOrganizationId === organizationId && candidateUserId === userId
        ? access()
        : null;
    },
    async findBySlug(organizationSlug, candidateUserId) {
      return organizationSlug === "opspresso" && candidateUserId === userId
        ? access()
        : null;
    }
  };
  const secret: OrganizationAgentTokenSecret = {
    generate() {
      generated += 1;
      return `amt_token_${generated}`;
    },
    hash(value) {
      return `hash:${value}`;
    },
    encrypt(value, candidateOrganizationId) {
      return `encrypted:${candidateOrganizationId}:${value}`;
    },
    decrypt(value, candidateOrganizationId) {
      const prefix = `encrypted:${candidateOrganizationId}:`;
      if (!value.startsWith(prefix)) {
        throw new Error("invalid ciphertext");
      }
      return value.slice(prefix.length);
    },
    matches(value, hash) {
      return hash === `hash:${value}`;
    },
    mask(value) {
      return `${value.slice(0, 4)}••••${value.slice(-4)}`;
    }
  };
  return {
    useCases: createOrganizationAgentTokenUseCases({
      accessRepository,
      clock: () => now,
      repository,
      secret
    }),
    setActive(value: boolean) {
      active = value;
    },
    stored() {
      return stored;
    },
    setStored(token: OrganizationAgentToken) {
      stored = token;
    }
  };
}

describe("organization Agent token", () => {
  it("uses a recognizable prefix with 256 bits of random secret material", () => {
    const organizationAgentTokenSecret = createOrganizationAgentTokenSecret(
      () => "test-better-auth-secret-with-at-least-32-characters"
    );
    const first = organizationAgentTokenSecret.generate();
    const second = organizationAgentTokenSecret.generate();

    expect(first).toMatch(/^amt_[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(
      organizationAgentTokenSecret.matches(
        first,
        organizationAgentTokenSecret.hash(first)
      )
    ).toBe(true);
    expect(
      organizationAgentTokenSecret.matches(
        second,
        organizationAgentTokenSecret.hash(first)
      )
    ).toBe(false);
    const encrypted = organizationAgentTokenSecret.encrypt(first, organizationId);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(first);
    expect(
      organizationAgentTokenSecret.decrypt(encrypted, organizationId)
    ).toBe(first);
    expect(() =>
      organizationAgentTokenSecret.decrypt(
        encrypted,
        "00000000-0000-4000-8000-000000000099"
      )
    ).toThrow();
    const wrongKey = createOrganizationAgentTokenSecret(
      () => "another-better-auth-secret-with-at-least-32-characters"
    );
    expect(() => wrongKey.decrypt(encrypted, organizationId)).toThrow();
  });

  it("generates one opaque token for an organization admin", async () => {
    const { stored, useCases } = dependencies();

    const generated = await useCases.generate(access());

    expect(generated).toEqual({
      token: "amt_token_1",
      masked: "amt_••••en_1",
      createdAt: now.toISOString()
    });
    await expect(useCases.status(access())).resolves.toEqual({
      configured: true,
      masked: generated.masked,
      createdAt: generated.createdAt,
      revealable: true
    });
    expect(stored()?.encryptedToken).toBe(
      `encrypted:${organizationId}:amt_token_1`
    );
    expect(stored()?.encryptedToken).not.toBe(generated.token);
    await expect(
      useCases.verify("opspresso", generated.token)
    ).resolves.toEqual(access());
    await expect(useCases.reveal(access())).resolves.toEqual({
      token: generated.token,
      createdAt: generated.createdAt
    });
  });

  it("regenerates atomically and invalidates the previous token", async () => {
    const { useCases } = dependencies();
    const first = await useCases.generate(access());
    const second = await useCases.generate(access());

    await expect(useCases.verify("opspresso", first.token)).resolves.toBeNull();
    await expect(useCases.verify("opspresso", second.token)).resolves.toEqual(
      access()
    );
  });

  it("revokes the token idempotently", async () => {
    const { useCases } = dependencies();
    const generated = await useCases.generate(access());

    await useCases.revoke(access());
    await useCases.revoke(access());

    await expect(useCases.status(access())).resolves.toEqual({
      configured: false
    });
    await expect(useCases.verify("opspresso", generated.token)).resolves.toBeNull();
  });

  it("requires an organization admin or owner to manage the token", async () => {
    const { useCases } = dependencies();

    await expect(useCases.generate(access("member"))).rejects.toBeInstanceOf(
      OrganizationAgentTokenAccessDeniedError
    );
    await expect(useCases.status(access("member"))).rejects.toBeInstanceOf(
      OrganizationAgentTokenAccessDeniedError
    );
    await expect(useCases.revoke(access("member"))).rejects.toBeInstanceOf(
      OrganizationAgentTokenAccessDeniedError
    );
    await expect(useCases.reveal(access("member"))).rejects.toBeInstanceOf(
      OrganizationAgentTokenAccessDeniedError
    );
  });

  it("stops authenticating when the issuing member loses active access", async () => {
    const { useCases, setActive } = dependencies();
    const generated = await useCases.generate(access());

    setActive(false);

    await expect(useCases.verify("opspresso", generated.token)).resolves.toBeNull();
  });

  it("does not authenticate the right token through another organization slug", async () => {
    const { useCases } = dependencies();
    const generated = await useCases.generate(access());

    await expect(useCases.verify("another-org", generated.token)).resolves.toBeNull();
  });

  it("keeps a legacy hash-only token valid but requires regeneration to reveal it", async () => {
    const { setStored, stored, useCases } = dependencies();
    const generated = await useCases.generate(access());
    const current = stored();
    if (!current) {
      throw new Error("expected a stored token");
    }
    setStored({
      organizationId: current.organizationId,
      userId: current.userId,
      tokenHash: current.tokenHash,
      masked: current.masked,
      createdAt: current.createdAt
    });

    await expect(useCases.verify("opspresso", generated.token)).resolves.toEqual(
      access()
    );
    await expect(useCases.status(access())).resolves.toMatchObject({
      configured: true,
      revealable: false
    });
    await expect(useCases.reveal(access())).rejects.toBeInstanceOf(
      OrganizationAgentTokenNotRevealableError
    );
  });

  it("does not expose a token when its ciphertext cannot be decrypted", async () => {
    const { setStored, stored, useCases } = dependencies();
    await useCases.generate(access());
    const current = stored();
    if (!current) {
      throw new Error("expected a stored token");
    }
    setStored({
      ...current,
      encryptedToken: `encrypted:${organizationId}:amt_another_token`
    });

    await expect(useCases.reveal(access())).rejects.toBeInstanceOf(
      OrganizationAgentTokenNotRevealableError
    );
  });
});
