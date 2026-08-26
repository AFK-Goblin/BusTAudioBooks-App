import { initializeApplication, resetStartupForTests } from "../startup";

test("initializes once and orders migration before consumers", async () => {
  resetStartupForTests();
  const calls: string[] = [];
  const deps = {
    migrate: async () => { calls.push("migrate"); return { ok: true as const, migrated: true, itemCount: 2 }; },
    settings: async () => { calls.push("settings"); },
    player: async () => { calls.push("player"); },
    downloads: async () => { calls.push("downloads"); },
  };
  const first = initializeApplication(deps);
  const second = initializeApplication(deps);
  expect(first).toBe(second);
  await first;
  expect(calls).toEqual(["migrate", "settings", "player", "downloads"]);
});

test("reports a migration warning but permits legacy startup", async () => {
  resetStartupForTests();
  const result = await initializeApplication({
    migrate: async () => ({ ok: false as const, error: new Error("bad data") }),
    settings: async () => {}, player: async () => {}, downloads: async () => {},
  });
  expect(result.ready).toBe(true);
  expect(result.warnings[0]?.stage).toBe("migration");
});
