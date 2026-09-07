import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from "node:crypto";

import type { AppSettingsSecretCipher } from "@/domain/settings/app-settings";

const encryptionPrefix = "enc:v1:";
const maskPrefix = "masked:";
const ivLength = 12;
const authTagLength = 16;

export function createAppSettingsSecretCipher(
  rootSecret: () => string | undefined
): AppSettingsSecretCipher {
  function encryptionKey(): Buffer {
    const secret = rootSecret() ?? "";
    if (secret.length < 32) {
      throw new Error(
        "BETTER_AUTH_SECRET must contain at least 32 characters to store secret overrides"
      );
    }
    return Buffer.from(
      hkdfSync("sha256", secret, "", "agent-memory/app-settings/v1", 32)
    );
  }

  return {
    encrypt(value, name) {
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
      cipher.setAAD(Buffer.from(name));
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
    decrypt(value, name) {
      if (!value.startsWith(encryptionPrefix)) {
        throw new Error(`Invalid ${name} settings ciphertext`);
      }
      const payload = Buffer.from(value.slice(encryptionPrefix.length), "base64");
      if (payload.length <= ivLength + authTagLength) {
        throw new Error(`Invalid ${name} settings ciphertext`);
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        encryptionKey(),
        payload.subarray(0, ivLength)
      );
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(payload.subarray(ivLength, ivLength + authTagLength));
      return Buffer.concat([
        decipher.update(payload.subarray(ivLength + authTagLength)),
        decipher.final()
      ]).toString("utf8");
    },
    isMasked(value) {
      return value.startsWith(maskPrefix);
    },
    mask(value) {
      const visible = value.startsWith(encryptionPrefix) ? 0 : Math.min(4, value.length);
      return `${maskPrefix}${visible > 0 ? value.slice(0, visible) : ""}${"•".repeat(
        Math.max(8, value.length - visible)
      )}`;
    }
  };
}
