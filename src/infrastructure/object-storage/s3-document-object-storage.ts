import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import type { DocumentObjectStorage } from "@/domain/document/document-services";
import {
  isSafeOperationalError,
  SafeOperationalError
} from "@/infrastructure/observability/safe-operational-error";

export interface S3DocumentObjectStorageOptions {
  readonly bucket: string;
  readonly client: S3Client;
}

export function createS3DocumentObjectStorage(
  options: S3DocumentObjectStorageOptions
): DocumentObjectStorage {
  const bucket = options.bucket.trim();
  if (bucket.length === 0) {
    throw new Error("S3 bucket must not be empty");
  }

  return {
    async put(key, content, contentType) {
      try {
        await options.client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: content,
            ContentLength: content.byteLength,
            ContentType: contentType
          })
        );
      } catch (error) {
        throw new SafeOperationalError("S3 object upload failed", {
          cause: error,
          code: "S3_PUT_FAILED"
        });
      }
    },
    async get(key) {
      try {
        const response = await options.client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        if (!response.Body) {
          throw new SafeOperationalError(
            "S3 object response did not contain a body",
            { code: "S3_BODY_MISSING" }
          );
        }
        return await response.Body.transformToByteArray();
      } catch (error) {
        if (error instanceof Error && isSafeOperationalError(error)) {
          throw error;
        }
        throw new SafeOperationalError("S3 object download failed", {
          cause: error,
          code: "S3_GET_FAILED"
        });
      }
    },
    async delete(key) {
      try {
        await options.client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key })
        );
      } catch (error) {
        throw new SafeOperationalError("S3 object deletion failed", {
          cause: error,
          code: "S3_DELETE_FAILED"
        });
      }
    }
  };
}

export interface S3ClientOptions {
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
}

export function createS3Client(options: S3ClientOptions): S3Client {
  if (
    (options.accessKeyId && !options.secretAccessKey) ||
    (!options.accessKeyId && options.secretAccessKey)
  ) {
    throw new Error("S3 access key ID and secret access key must be set together");
  }

  return new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.forcePathStyle !== undefined
      ? { forcePathStyle: options.forcePathStyle }
      : {}),
    ...(options.accessKeyId && options.secretAccessKey
      ? {
          credentials: {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey
          }
        }
      : {})
  });
}
