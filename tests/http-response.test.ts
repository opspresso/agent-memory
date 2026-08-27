import { describe, expect, it } from "vitest";

import { responseJson } from "@/app/http-response";

describe("HTTP response JSON", () => {
  it("preserves a structured API error", async () => {
    const response = Response.json(
      { error: "Database migration is required" },
      { status: 500 }
    );

    await expect(responseJson(response, "Request failed")).rejects.toThrow(
      "Database migration is required"
    );
  });

  it("uses the operation fallback for an empty error response", async () => {
    const response = new Response(null, { status: 502 });

    await expect(responseJson(response, "Request failed")).rejects.toThrow(
      "Request failed"
    );
  });

  it("rejects an invalid successful response with the operation fallback", async () => {
    const response = new Response("not JSON", { status: 200 });

    await expect(responseJson(response, "Request failed")).rejects.toThrow(
      "Request failed"
    );
  });

  it("returns a successful JSON response", async () => {
    const response = Response.json({ hits: [{ id: "result-1" }] });

    await expect(
      responseJson<{ hits: readonly { id: string }[] }>(
        response,
        "Request failed"
      )
    ).resolves.toEqual({ hits: [{ id: "result-1" }] });
  });
});
