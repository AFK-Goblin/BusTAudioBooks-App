import { ApiClient } from "../client";

describe("typed API client", () => {
  it("classifies HTTP 403 without exposing the configuration URL", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ error: "no" }), { status: 403 }));
    const client = new ApiClient(async () => "https://audio.example/SECRET_CONFIG", fetcher);

    await expect(client.get("/app/version", (value) => value)).rejects.toMatchObject({
      kind: "authentication",
      operation: "GET /app/version",
      status: 403,
    });
  });

  it("classifies an invalid response contract", async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify({ results: "wrong" }), { status: 200 }));
    const client = new ApiClient(async () => "https://audio.example/config", fetcher);

    await expect(client.get("/app/search", () => { throw new Error("results must be an array"); })).rejects.toMatchObject({
      kind: "invalid-response",
      operation: "GET /app/search",
    });
  });
});
