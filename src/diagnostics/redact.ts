function redactString(value: string): string {
  if (value.startsWith("file://")) {
    const filename = value.split("/").filter(Boolean).at(-1) ?? "file";
    return `file:///[PRIVATE_PATH]/${filename}`;
  }
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.at(-1)?.toLowerCase() === "manifest.json" && parts.length > 1) {
      parts[parts.length - 2] = "[REDACTED]";
      url.pathname = `/${parts.join("/")}`;
    }
    if (url.search) url.search = "?[REDACTED]";
    return url.toString();
  } catch {
    return value.replace(/\b(?:token|api[_-]?key|authorization)\s*[:=]\s*[^\s,]+/gi, "$1=[REDACTED]");
  }
}

export function redactDiagnosticValue<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map(redactDiagnosticValue) as T;
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDiagnosticValue(item)]),
    ) as T;
  }
  return value;
}
