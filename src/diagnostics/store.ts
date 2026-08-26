import { redactDiagnosticValue } from "./redact";

export interface DiagnosticEntry {
  timestamp: number;
  operation: string;
  category: string;
  detail?: unknown;
}

export class DiagnosticStore {
  private readonly entries: DiagnosticEntry[] = [];

  constructor(private readonly maximumEntries = 100) {}

  add(entry: DiagnosticEntry): void {
    this.entries.push(redactDiagnosticValue(entry));
    if (this.entries.length > this.maximumEntries) this.entries.splice(0, this.entries.length - this.maximumEntries);
  }

  list(): DiagnosticEntry[] {
    return structuredClone(this.entries);
  }
}
