import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import type { DocumentObjectStorage } from "@/domain/document/document-services";

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
      await options.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentLength: content.byteLength,
          ContentType: contentType
        })
      );
    },
    async get(key) {
      const response = await options.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      if (!response.Body) {
        throw new Error("S3 object response did not contain a body");
      }
      return response.Body.transformToByteArray();
    },
    async delete(key) {
      await options.client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key })
      );
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
