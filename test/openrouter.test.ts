import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouter, AuthError, ServerError, ContentError } from "../src/openrouter.js";

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env["OPEN-ROUTER_KEY"] = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenRouter", () => {
  it("throws AuthError on 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401, headers: { "x-request-id": "r1" } }));
    const client = new OpenRouter();
    await expect(client.chat({ model: "m", prompt: "p" })).rejects.toBeInstanceOf(AuthError);
  });

  it("retries on 5xx and eventually throws ServerError", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500, headers: { "x-request-id": "r2" } }));
    const client = new OpenRouter({ maxRetries: 2, backoffBaseMs: 1 });
    await expect(client.chat({ model: "m", prompt: "p" })).rejects.toBeInstanceOf(ServerError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "x-request-id": "r3" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const client = new OpenRouter({ maxRetries: 2, backoffBaseMs: 1 });
    const res = await client.chat({ model: "m", prompt: "p" });
    expect(res).toEqual({ choices: [{ message: { content: "ok" } }] });
  });

  it("throws ContentError when 200 body is missing expected payload via extractor", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const client = new OpenRouter();
    await expect(
      client.generateImage({ model: "m", prompt: "p", seed: 1 }),
    ).rejects.toBeInstanceOf(ContentError);
  });
});
