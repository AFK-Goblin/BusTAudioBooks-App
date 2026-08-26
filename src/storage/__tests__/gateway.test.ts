import AsyncStorage from "@react-native-async-storage/async-storage";
import { readJson, updateJson } from "../gateway";
import type { ParseResult } from "../../domain/models";

type Counter = { count: number };

function parseCounter(value: unknown): ParseResult<Counter> {
  if (
    value != null &&
    typeof value === "object" &&
    typeof (value as { count?: unknown }).count === "number"
  ) {
    return { ok: true, value: { count: (value as { count: number }).count } };
  }
  return { ok: false, issues: ["count is required"] };
}

describe("validated storage gateway", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("serializes concurrent updates to the same key", async () => {
    await AsyncStorage.setItem("counter", JSON.stringify({ count: 0 }));

    await Promise.all([
      updateJson("counter", parseCounter, async (value) => {
        await Promise.resolve();
        return { count: value.count + 1 };
      }),
      updateJson("counter", parseCounter, async (value) => ({ count: value.count + 1 })),
    ]);

    expect(await readJson("counter", parseCounter)).toEqual({ ok: true, value: { count: 2 } });
  });

  it("returns corrupt raw data without overwriting it", async () => {
    await AsyncStorage.setItem("counter", "{broken");

    expect(await readJson("counter", parseCounter)).toEqual({
      ok: false,
      kind: "corrupt",
      raw: "{broken",
      issues: ["stored JSON is malformed"],
    });
    expect(await AsyncStorage.getItem("counter")).toBe("{broken");
  });
});
