export function objectContract(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("response must be an object");
  }
  return value as Record<string, unknown>;
}

export function resultsContract(value: unknown): unknown[] {
  const response = objectContract(value);
  if (!Array.isArray(response.results)) throw new Error("results must be an array");
  return response.results;
}
