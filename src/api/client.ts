import { ApiError } from "./errors";

export class ApiClient {
  constructor(
    private readonly getPrefix: () => Promise<string | null>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async get<T>(path: string, parse: (value: unknown) => T, timeoutMs = 20_000): Promise<T> {
    const operation = `GET ${path}`;
    const prefix = await this.getPrefix();
    if (!prefix) throw new ApiError("authentication", operation, "App is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(`${prefix}${path}`, { signal: controller.signal });
      if (response.status === 403) throw new ApiError("authentication", operation, "Access rejected", 403);
      if (response.status === 503) throw new ApiError("source-unavailable", operation, "Source unavailable", 503);
      if (!response.ok) throw new ApiError("server", operation, "Server request failed", response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiError("invalid-response", operation, "Server returned malformed JSON", response.status);
      }
      try {
        return parse(body);
      } catch {
        throw new ApiError("invalid-response", operation, "Server response did not match its contract", response.status);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError("timeout", operation, "Request timed out");
      }
      if (error instanceof TypeError) throw new ApiError("offline", operation, "Network unavailable");
      throw new ApiError("unknown", operation, "Request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
