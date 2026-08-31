import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import {
  organizationAgentTokenPrefix,
  type OrganizationAgentTokenSecret
} from "@/domain/identity/organization-agent-token-repository";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const encryptionPrefix = "enc:v1:";
const ivLength = 12;
const authTagLength = 16;

export function createOrganizationAgentTokenSecret(
  rootSecret: () => string
): OrganizationAgentTokenSecret {
  function encryptionKey(): Buffer {
    const secret = rootSecret();
    if (secret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
    }
    return Buffer.from(
      hkdfSync(
        "sha256",
        secret,
        "",
        "agent-memory/organization-agent-token/v1",
        32
      )
    );
  }

  return {
    generate() {
      return `${organizationAgentTokenPrefix}${randomBytes(32).toString("base64url")}`;
    },
    hash,
    encrypt(value, organizationId) {
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
      cipher.setAAD(Buffer.from(organizationId, "utf8"));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final()
      ]);
      return `${encryptionPrefix}${Buffer.concat([
        iv,
        cipher.getAuthTag(),
        encrypted
      ]).toString("base64")}`;
    },
    decrypt(value, organizationId) {
      if (!value.startsWith(encryptionPrefix)) {
        throw new Error("Invalid organization Agent token ciphertext");
      }
      const payload = Buffer.from(value.slice(encryptionPrefix.length), "base64");
      if (payload.length <= ivLength + authTagLength) {
        throw new Error("Invalid organization Agent token ciphertext");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        encryptionKey(),
        payload.subarray(0, ivLength)
      );
      decipher.setAAD(Buffer.from(organizationId, "utf8"));
      decipher.setAuthTag(
        payload.subarray(ivLength, ivLength + authTagLength)
      );
      return Buffer.concat([
        decipher.update(payload.subarray(ivLength + authTagLength)),
        decipher.final()
      ]).toString("utf8");
    },
    matches(value, expectedHash) {
      const candidateHash = hash(value);
      return (
        candidateHash.length === expectedHash.length &&
        timingSafeEqual(Buffer.from(candidateHash), Buffer.from(expectedHash))
      );
    },
    mask(value) {
      return `${value.slice(0, 4)}${"•".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
    }
  };
}
