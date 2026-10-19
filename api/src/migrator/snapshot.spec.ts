import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectSnapshot } from "./snapshot";
import { backup, loadSnapshot } from "./migrator";

describe("legacy snapshot validation", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "legacy-migration-"));
    await Promise.all(["watchlist.json", "streams.json", "sessions.json"].map((file) => writeFile(join(directory, file), "[]")));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it("validates without creating files", async () => {
    expect((await inspectSnapshot(directory)).errors).toEqual([]);
    expect((await readdir(directory)).length).toBe(3);
  });
  it("rejects malformed sources and orphan history", async () => {
    await writeFile(join(directory, "watchlist.json"), "{");
    await writeFile(join(directory, "sessions.json"), JSON.stringify([{ session_id: "invalid", channel_id: "missing" }]));
    const report = await inspectSnapshot(directory);
    expect(report.errors.join(" ")).toMatch(/invalid or unreadable/);
    expect(report.errors.join(" ")).toMatch(/orphan/);
  });
  it("rejects duplicate JSON keys", async () => {
    await writeFile(join(directory, "watchlist.json"), '[{"id":"one","id":"two"}]');
    expect((await inspectSnapshot(directory)).errors.join(" ")).toMatch(/duplicate object key/);
  });
  it("requires quiescence and verifies private backup digests before import", async () => {
    const destination = `${directory}-backup`;
    try {
      await expect(backup(directory, destination, false)).rejects.toThrow(/quiesced/);
      const manifest = await backup(directory, destination, true);
      expect(manifest.counts.watchTargets).toBe(0);
      await expect(loadSnapshot(destination, join(destination, "manifest.json"))).resolves.toBeDefined();
      await writeFile(join(destination, "sessions.json"), "[ ]");
      await expect(loadSnapshot(destination, join(destination, "manifest.json"))).rejects.toThrow(/drift/);
    } finally { await rm(destination, { recursive: true, force: true }); }
  });
});