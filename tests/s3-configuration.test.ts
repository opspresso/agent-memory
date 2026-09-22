import { describe, expect, it } from "vitest";
import { readS3Configuration } from "@/lib/s3-configuration";
import { createS3Client } from "@/infrastructure/object-storage/s3-document-object-storage";

describe("deployment S3 configuration", () => {
  it("leaves AWS credentials and endpoint to the SDK for Pod Identity", () => {
    const options = readS3Configuration({ S3_REGION: "ap-northeast-2" });
    expect(options.endpoint).toBeUndefined();
    expect(options.accessKeyId).toBeUndefined();
    expect(options.secretAccessKey).toBeUndefined();
    expect(createS3Client(options).config.forcePathStyle).toBe(false);
  });

  it("preserves MinIO credentials and path-style addressing", async () => {
    const options = readS3Configuration({
      S3_ENDPOINT: "http://minio:9000",
      S3_ACCESS_KEY_ID: "minio-user",
      S3_SECRET_ACCESS_KEY: "minio-password"
    });
    const client = createS3Client(options);
    expect(await client.config.credentials()).toMatchObject({
      accessKeyId: "minio-user", secretAccessKey: "minio-password"
    });
    expect(client.config.forcePathStyle).toBe(true);
    expect((await client.config.endpoint?.())?.hostname).toBe("minio");
  });

  it("honors an explicit virtual-host addressing setting", () => {
    expect(readS3Configuration({
      S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
      S3_FORCE_PATH_STYLE: "false"
    }).forcePathStyle).toBe(false);
  });

  it.each([
    { S3_ACCESS_KEY_ID: "key" },
    { S3_SECRET_ACCESS_KEY: "secret" }
  ])("rejects incomplete credentials: %j", (environment) => {
    expect(() => readS3Configuration(environment)).toThrow("must be set together");
  });
});
