import { STORAGE_SCHEMA_VERSION, type PlaybackSessionRecord } from "../../domain/models";
import { CheckpointWriter, type CheckpointInput } from "../checkpointWriter";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function at(positionSeconds: number): CheckpointInput {
  const session: PlaybackSessionRecord = {
    schemaVersion: STORAGE_SCHEMA_VERSION, itemId: "book", queueRevision: "rev", activeTrackIndex: 0,
    positionSeconds, rate: 1, intendedState: "playing", checkpointedAt: positionSeconds,
  };
  return { session, libraryProgress: { position: positionSeconds, duration: 100, trackIndex: 0, finished: false } };
}

test("serializes writes and coalesces pending positions to the newest", async () => {
  const gate = deferred();
  const positions: number[] = [];
  const sessionRepository = { checkpoint: jest.fn(async (session: PlaybackSessionRecord) => {
    positions.push(session.positionSeconds);
    if (positions.length === 1) await gate.promise;
  }) };
  const library = { checkpoint: jest.fn(async (_bookId: string, _progress: CheckpointInput["libraryProgress"]) => {}) };
  const writer = new CheckpointWriter(sessionRepository, library);

  void writer.enqueue(at(100));
  await Promise.resolve();
  void writer.enqueue(at(105));
  void writer.enqueue(at(110));
  gate.resolve();
  await writer.flush();

  expect(positions).toEqual([100, 110]);
  expect(library.checkpoint.mock.calls.map(([, progress]) => progress.position)).toEqual([100, 110]);
});

test("deduplicates identical durable snapshots even when timestamps change", async () => {
  const sessionRepository = { checkpoint: jest.fn(async () => {}) };
  const library = { checkpoint: jest.fn(async () => {}) };
  const writer = new CheckpointWriter(sessionRepository, library);
  await writer.enqueue(at(25));
  const same = at(25); same.session.checkpointedAt = 999;
  await writer.enqueue(same);
  expect(sessionRepository.checkpoint).toHaveBeenCalledTimes(1);
});

test("reports a failed write and accepts the next checkpoint", async () => {
  const onError = jest.fn();
  const sessionRepository = { checkpoint: jest.fn()
    .mockRejectedValueOnce(new Error("disk full"))
    .mockResolvedValue(undefined) };
  const library = { checkpoint: jest.fn(async () => {}) };
  const writer = new CheckpointWriter(sessionRepository, library, onError);
  await expect(writer.enqueue(at(5))).resolves.toBeUndefined();
  await expect(writer.enqueue(at(10))).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full" }));
  expect(sessionRepository.checkpoint).toHaveBeenCalledTimes(2);
  expect(library.checkpoint).toHaveBeenCalledTimes(1);
});
