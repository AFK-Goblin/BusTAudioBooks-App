import { runStorageMigration, type MigrationResult } from "./storage/migrate";

export type StartupWarning = { stage: "migration" | "settings" | "player" | "downloads"; message: string };
export type StartupResult = {
  ready: true;
  warnings: StartupWarning[];
  migration?: MigrationResult;
  // Player restore and download resume, still running when the UI appears.
  background: Promise<StartupWarning[]>;
};
type StartupDependencies = {
  migrate: () => Promise<MigrationResult>;
  settings: () => Promise<unknown>;
  player: () => Promise<unknown>;
  downloads: () => Promise<unknown>;
};

let startupPromise: Promise<StartupResult> | null = null;

// Resolves as soon as the first screen can render: storage migrated and
// settings loaded (both local and quick). Restoring the last book is NOT
// waited for — for a streamed book it means a TorBox round-trip plus
// buffering, which used to hold the loading spinner for many seconds.
// Anything that needs the player (loadBook, the background service) awaits
// the session's own initialize(), so starting it late is safe.
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
    try { await actual.settings(); } catch (error) { warnings.push({ stage: "settings", message: message(error) }); }
    const background = Promise.all(([["player", actual.player], ["downloads", actual.downloads]] as const).map(
      async ([stage, operation]): Promise<StartupWarning | null> => {
        try { await operation(); return null; } catch (error) { return { stage, message: message(error) }; }
      },
    )).then((results) => results.filter((w): w is StartupWarning => w !== null));
    return { ready: true, warnings, background, ...(migration ? { migration } : {}) };
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
