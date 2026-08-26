import { runStorageMigration, type MigrationResult } from "./storage/migrate";

export type StartupWarning = { stage: "migration" | "settings" | "player" | "downloads"; message: string };
export type StartupResult = { ready: true; warnings: StartupWarning[]; migration?: MigrationResult };
type StartupDependencies = {
  migrate: () => Promise<MigrationResult>;
  settings: () => Promise<unknown>;
  player: () => Promise<unknown>;
  downloads: () => Promise<unknown>;
};

let startupPromise: Promise<StartupResult> | null = null;

export function initializeApplication(deps?: StartupDependencies): Promise<StartupResult> {
  if (startupPromise) return startupPromise;
  startupPromise = (async () => {
    const warnings: StartupWarning[] = [];
    const actual = deps ?? await defaultDependencies();
    let migration: MigrationResult | undefined;
    try {
      migration = await actual.migrate();
      if (!migration.ok) warnings.push({ stage: "migration", message: migration.error.message });
    } catch (error) {
      warnings.push({ stage: "migration", message: message(error) });
    }
    for (const [stage, operation] of [
      ["settings", actual.settings], ["player", actual.player], ["downloads", actual.downloads],
    ] as const) {
      try { await operation(); } catch (error) { warnings.push({ stage, message: message(error) }); }
    }
    return { ready: true, warnings, ...(migration ? { migration } : {}) };
  })();
  return startupPromise;
}

async function defaultDependencies(): Promise<StartupDependencies> {
  const [{ initSettings }, { setupPlayer }, { resumePendingDownloads }] = await Promise.all([
    import("./settings"), import("./player"), import("./downloads"),
  ]);
  return { migrate: runStorageMigration, settings: initSettings, player: setupPlayer, downloads: resumePendingDownloads };
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
export function resetStartupForTests() { startupPromise = null; }
