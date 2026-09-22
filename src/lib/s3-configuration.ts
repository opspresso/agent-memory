import type { S3ClientOptions } from "@/infrastructure/object-storage/s3-document-object-storage";

export function readS3Configuration(
  environment: Readonly<Record<string, string | undefined>> = process.env
): S3ClientOptions {
  const endpoint = environment.S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = environment.S3_ACCESS_KEY_ID?.trim() || undefined;
  const secretAccessKey = environment.S3_SECRET_ACCESS_KEY?.trim() || undefined;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY must be set together");
  }
  return {
    endpoint,
    region: environment.S3_REGION ?? "ap-northeast-2",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE === undefined
      ? Boolean(endpoint)
      : environment.S3_FORCE_PATH_STYLE === "true"
  };
}
