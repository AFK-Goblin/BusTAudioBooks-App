export type ApiErrorKind =
  | "offline"
  | "timeout"
  | "authentication"
  | "server"
  | "source-unavailable"
  | "not-ready"
  | "invalid-response"
  | "unknown";

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    public readonly operation: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
