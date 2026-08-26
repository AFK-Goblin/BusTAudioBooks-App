import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ParseResult } from "../domain/models";

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "missing" }
  | { ok: false; kind: "corrupt"; raw: string; issues: string[] }
  | { ok: false; kind: "storage"; error: Error };

const queues = new Map<string, Promise<void>>();

function storageError(error: unknown): StorageResult<never> {
  return { ok: false, kind: "storage", error: error instanceof Error ? error : new Error(String(error)) };
}

export async function readJson<T>(key: string, parser: (value: unknown) => ParseResult<T>): Promise<StorageResult<T>> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error) {
    return storageError(error);
  }
  if (raw == null) return { ok: false, kind: "missing" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, kind: "corrupt", raw, issues: ["stored JSON is malformed"] };
  }
  const parsed = parser(decoded);
  return parsed.ok ? parsed : { ok: false, kind: "corrupt", raw, issues: parsed.issues };
}

export async function writeJson<T>(key: string, value: T, parser: (value: unknown) => ParseResult<T>): Promise<StorageResult<T>> {
  const parsed = parser(value);
  if (!parsed.ok) return { ok: false, kind: "corrupt", raw: JSON.stringify(value), issues: parsed.issues };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(parsed.value));
    return parsed;
  } catch (error) {
    return storageError(error);
  }
}

export function updateJson<T>(
  key: string,
  parser: (value: unknown) => ParseResult<T>,
  mutate: (value: T) => T | Promise<T>,
): Promise<StorageResult<T>> {
  const previous = queues.get(key) || Promise.resolve();
  let result: StorageResult<T>;
  const operation = previous.then(async () => {
    const current = await readJson(key, parser);
    if (!current.ok) {
      result = current;
      return;
    }
    result = await writeJson(key, await mutate(current.value), parser);
  });
  const settled = operation.then(() => undefined, () => undefined);
  queues.set(key, settled);
  return operation.then(
    () => result!,
    (error) => storageError(error),
  ).finally(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
}

export async function removeStoredValue(key: string): Promise<StorageResult<null>> {
  try {
    await AsyncStorage.removeItem(key);
    return { ok: true, value: null };
  } catch (error) {
    return storageError(error);
  }
}
