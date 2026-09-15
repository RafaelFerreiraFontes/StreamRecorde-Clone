import { open, readFile, rename, unlink } from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { Recording, RecordingState, Stream, StreamPlatform, WatchTarget } from "./domain.model";

interface WatchlistEntry {
  id: string;
  display_name?: string;
  channel_name: string;
  platform: string;
  url: string;
  quality: string;
}

interface ChannelStatus {
  channel_name: string;
  platform: string;
  state: RecordingState;
}

interface SessionEntry {
  session_id: string;
  channel_id: string;
  started_at: string;
  finished_at: string | null;
  output_file: string | null;
  state: RecordingState;
}

const readAttempts = 3;

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

async function readJson<T>(filePath: string, emptyValue: T, expected: "array" | "object"): Promise<T> {
  for (let attempt = 1; attempt <= readAttempts; attempt += 1) {
    try {
      const raw = await readFile(filePath, "utf-8");
      if (!raw.trim()) throw new Error(`JSON file is empty: ${filePath}`);
      const value: unknown = JSON.parse(raw);
      if (expected === "array" ? !Array.isArray(value) : !isRecord(value)) {
        throw new Error(`JSON file has an invalid shape: ${filePath}`);
      }
      return value as T;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyValue;
      const retryable = error instanceof SyntaxError || isTransientFileError(error);
      if (!retryable || attempt === readAttempts) throw error;
      await delay();
    }
  }
  throw new Error(`Unable to read JSON file: ${filePath}`);
}

function isTransientFileError(error: unknown): boolean {
  return ["EBUSY", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, "w");
    await handle.writeFile(JSON.stringify(value, null, 2), "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export class WatchTargetJsonAdapter {
  static async read(filePath: string): Promise<WatchlistEntry[]> {
    return readJson(filePath, [], "array");
  }

  static async write(filePath: string, entries: WatchlistEntry[]): Promise<void> {
    await writeJsonAtomically(filePath, entries);
  }

  static toDomain(entry: WatchlistEntry, state: RecordingState = "idle"): WatchTarget {
    const displayName = entry.display_name?.trim() || entry.channel_name || "unknown-creator";
    return {
      id: entry.id,
      creator_id: displayName,
      channel_name: entry.channel_name,
      platform: (entry.platform as StreamPlatform) || "youtube",
      url: entry.url ?? "",
      quality: entry.quality ?? "best",
      enabled: true,
      state,
    };
  }

  static fromDomain(target: WatchTarget, displayName = target.creator_id): WatchlistEntry {
    return {
      id: target.id,
      display_name: displayName,
      channel_name: target.channel_name,
      platform: target.platform,
      url: target.url,
      quality: target.quality,
    };
  }
}

export class RuntimeStatusJsonAdapter {
  static async read(filePath: string): Promise<Record<string, ChannelStatus>> {
    return readJson(filePath, {}, "object");
  }
}

export class RecordingJsonAdapter {
  static async read(filePath: string): Promise<Recording[]> {
    const sessions = await readJson<SessionEntry[]>(filePath, [], "array");
    return sessions.map((session) => this.toDomain(session));
  }

  static toDomain(session: SessionEntry): Recording {
    return {
      session_id: session.session_id,
      watch_target_id: session.channel_id,
      started_at: session.started_at,
      ...(session.finished_at ? { finished_at: session.finished_at } : {}),
      ...(session.output_file ? { output_file: session.output_file } : {}),
      state: session.state,
    };
  }

  static fromDomain(recording: Recording): SessionEntry {
    return {
      session_id: recording.session_id,
      channel_id: recording.watch_target_id,
      started_at: recording.started_at,
      finished_at: recording.finished_at ?? null,
      output_file: recording.output_file ?? null,
      state: recording.state,
    };
  }
}

export class StreamJsonAdapter {
  static async read(filePath: string): Promise<Stream[]> {
    return readJson(filePath, [], "array");
  }
}

