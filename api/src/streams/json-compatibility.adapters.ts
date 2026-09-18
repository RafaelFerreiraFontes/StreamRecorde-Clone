import { open, readFile, rename, unlink, mkdir } from "fs/promises";
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
  /** Optional relative recording subdirectory. */
  recording_subdir?: string;
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

// ─── Path resolution constants ─────────────────────────────────────────────────

const CONFIG_FILENAMES = {
  watchlist: "watchlist.json",
  channels_status: "channels_status.json",
  sessions: "sessions.json",
  streams: "streams.json",
} as const;

type ConfigFileKey = keyof typeof CONFIG_FILENAMES;

/** Non-empty string check. Empty string is NOT a valid override. */
function isNonEmpty(v: string | undefined): v is string {
  return v !== undefined && v.trim() !== "";
}

/**
 * Resolve all four config paths from an explicit env mapping.
 * Precedence for each path:
 *   1. NON-EMPTY individual env var > NON-EMPTY CONFIG_DIR + filename > local default
 *   2. Empty string/whitespace env var does NOT win - falls through to next level
 *
 * @param env - Explicit environment variable mapping (e.g., process.env or test mapping)
 */
export function resolveAllConfigPaths(
  env: Record<string, string | undefined>,
): {
  watchlist: string;
  channels_status: string;
  sessions: string;
  streams: string;
} {
  // Individual overrides from env
  const watchlistOverride = env.WATCHLIST_PATH;
  const channelsStatusOverride = env.CHANNELS_STATUS_PATH;
  const sessionsOverride = env.SESSIONS_PATH;
  const streamsOverride = env.STREAMS_PATH;
  const configDirOverride = env.CONFIG_DIR;

  // Level 2: non-empty CONFIG_DIR
  const configDir = isNonEmpty(configDirOverride)
    ? configDirOverride.trim()
    : undefined;

  // Local default: worker/config relative to cwd (established local behavior)
  const localDefault = path.join(process.cwd(), "..", "worker", "config");

  // Resolve each path with precedence
  // Use simple string concatenation for absolute paths to preserve forward slashes
  const resolveSingle = (
    key: ConfigFileKey,
    override: string | undefined,
  ): string => {
    // Level 1: non-empty individual override wins
    if (isNonEmpty(override)) {
      return override.trim();
    }
    // Level 2: non-empty CONFIG_DIR + filename
    if (configDir) {
      // Normalize separators for cross-platform consistency
      const normalizedConfigDir = configDir.replace(/\\/g, "/");
      return normalizedConfigDir + "/" + CONFIG_FILENAMES[key];
    }
    // Level 3: local default
    return path.join(localDefault, CONFIG_FILENAMES[key]);
  };

  return {
    watchlist: resolveSingle("watchlist", watchlistOverride),
    channels_status: resolveSingle("channels_status", channelsStatusOverride),
    sessions: resolveSingle("sessions", sessionsOverride),
    streams: resolveSingle("streams", streamsOverride),
  };
}

/**
 * Resolve a single config file path.
 * Exported for backward compatibility; prefer resolveAllConfigPaths for most uses.
 */
export function resolveConfigPath(
  fileKey: ConfigFileKey,
  env: Record<string, string | undefined>,
): string {
  const envKey =
    fileKey === "channels_status"
      ? env.CHANNELS_STATUS_PATH
      : env[`${fileKey.toUpperCase()}_PATH`];
  const paths = resolveAllConfigPaths(env);
  return paths[fileKey];
}

export interface ResolvedConfigPaths {
  watchlist: string;
  channels_status: string;
  sessions: string;
  streams: string;
}

/**
 * Initialize runtime files from resolved paths.
 * Creates each dirname(path) recursively and exclusive-creates missing files
 * with canonical JSON shapes. Never overwrites existing files.
 *
 * @param paths - Pre-resolved config file paths
 * @throws Error if a file cannot be created (parent dir creation failure, etc.)
 */
export async function initializeRuntimeFiles(
  paths: ResolvedConfigPaths,
): Promise<void> {
  // Canonical shapes for each file
  const canonicalShapes: Record<ConfigFileKey, unknown> = {
    watchlist: [],
    channels_status: {},
    sessions: [],
    streams: [],
  };

  // Create each parent dir and exclusive-create missing file
  for (const fileKey of Object.keys(CONFIG_FILENAMES) as ConfigFileKey[]) {
    const filePath = paths[fileKey];
    const parentDir = path.dirname(filePath);

    // Create parent directory recursively
    await mkdir(parentDir, { recursive: true });

    // Exclusive-create missing file (skip if already exists)
    try {
      const handle = await open(filePath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify(canonicalShapes[fileKey], null, 2),
          "utf-8",
        );
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      // File already exists - this is fine, skip
    }
  }
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
      recording_subdir: entry.recording_subdir,
    };
  }

  static fromDomain(target: WatchTarget, displayName = target.creator_id): WatchlistEntry {
    const entry: WatchlistEntry = {
      id: target.id,
      display_name: displayName,
      channel_name: target.channel_name,
      platform: target.platform,
      url: target.url,
      quality: target.quality,
    };
    if (target.recording_subdir) {
      entry.recording_subdir = target.recording_subdir;
    }
    return entry;
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

