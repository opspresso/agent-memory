import { describe, expect, it } from "vitest";
import { z } from "zod";

import { responseJson } from "@/app/http-response";

describe("HTTP response JSON", () => {
  it("preserves a structured API error", async () => {
    const response = Response.json(
      { error: "Database initialization is required" },
      { status: 500 }
    );

    await expect(
      responseJson(response, "Request failed", z.unknown())
    ).rejects.toThrow("Database initialization is required");
  });

  it("uses the operation fallback for an empty error response", async () => {
    const response = new Response(null, { status: 502 });

    await expect(
      responseJson(response, "Request failed", z.object({}))
    ).rejects.toThrow("Request failed");
  });

  it("rejects an invalid successful response with the operation fallback", async () => {
    const response = new Response("not JSON", { status: 200 });

    await expect(
      responseJson(response, "Request failed", z.object({}))
    ).rejects.toThrow("Request failed");
  });

  it("returns a successful JSON response", async () => {
    const response = Response.json({ hits: [{ id: "result-1" }] });

    await expect(
      responseJson(
        response,
        "Request failed",
        z.object({ hits: z.array(z.object({ id: z.string() })) })
      )
    ).resolves.toEqual({ hits: [{ id: "result-1" }] });
  });

  it("rejects JSON that does not match the endpoint schema", async () => {
    const response = Response.json({ hits: [{ id: 42 }] });

    await expect(
      responseJson(
        response,
        "Request failed",
        z.object({ hits: z.array(z.object({ id: z.string() })) })
      )
    ).rejects.toThrow("Request failed");
  });
});
