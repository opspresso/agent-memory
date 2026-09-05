import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import {
  createS3Client,
  createS3DocumentObjectStorage
} from "@/infrastructure/object-storage/s3-document-object-storage";

function clientWithSend(send: ReturnType<typeof vi.fn>): S3Client {
  const client = new S3Client({ region: "ap-northeast-2" });
  vi.spyOn(client, "send").mockImplementation(send as S3Client["send"]);
  return client;
}

describe("S3 document object storage", () => {
  it("writes source bytes with explicit object metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createS3DocumentObjectStorage({
      bucket: " documents ",
      client: clientWithSend(send)
    });
    const content = new TextEncoder().encode("source text");

    await storage.put("organization/document/source", content, "text/plain");

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: "documents",
      Key: "organization/document/source",
      Body: content,
      ContentLength: content.byteLength,
      ContentType: "text/plain"
    });
  });

  it("returns downloaded bytes and rejects a missing body", async () => {
    const transformToByteArray = vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3]));
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Body: { transformToByteArray } })
      .mockResolvedValueOnce({});
    const storage = createS3DocumentObjectStorage({
      bucket: "documents",
      client: clientWithSend(send)
    });

    await expect(storage.get("source-1")).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(transformToByteArray).toHaveBeenCalledOnce();
    await expect(storage.get("source-2")).rejects.toThrow(
      "S3 object response did not contain a body"
    );
  });

  it("deletes the exact object key", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createS3DocumentObjectStorage({
      bucket: "documents",
      client: clientWithSend(send)
    });

    await storage.delete("organization/document/source");

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({
      Bucket: "documents",
      Key: "organization/document/source"
    });
  });

  it("translates asynchronous download stream failures", async () => {
    const failure = new Error("private storage response");
    const storage = createS3DocumentObjectStorage({
      bucket: "documents",
      client: clientWithSend(vi.fn().mockResolvedValue({
        Body: { transformToByteArray: vi.fn().mockRejectedValue(failure) }
      }))
    });

    await expect(storage.get("source")).rejects.toMatchObject({
      name: "SafeOperationalError",
      message: "S3 object download failed",
      code: "S3_GET_FAILED",
      cause: failure
    });
  });

  it("rejects empty buckets and partial static credentials", () => {
    const client = new S3Client({ region: "ap-northeast-2" });
    expect(() =>
      createS3DocumentObjectStorage({ bucket: " ", client })
    ).toThrow("S3 bucket must not be empty");
    expect(() =>
      createS3Client({
        region: "ap-northeast-2",
        accessKeyId: "access-key"
      })
    ).toThrow("S3 access key ID and secret access key must be set together");
    expect(() =>
      createS3Client({
        region: "ap-northeast-2",
        secretAccessKey: "secret-key"
      })
    ).toThrow("S3 access key ID and secret access key must be set together");
  });
});
