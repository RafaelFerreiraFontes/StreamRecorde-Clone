import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WATCH_TARGET_QUALITIES } from "../streams/dto/watch-target.dto";
import { visit } from "jsonc-parser";
import { isISO8601 } from "class-validator";

export const TOOL_VERSION = "legacy-json-v1";
export const FILES = [
  "watchlist.json",
  "streams.json",
  "sessions.json",
  "channels_status.json",
] as const;
export type Row = Record<string, unknown>;
export type Counts = {
  creators: number;
  watchTargets: number;
  streams: number;
  recordings: number;
};
export type Snapshot = {
  errors: string[];
  warnings: string[];
  counts: Counts;
  rows: Record<(typeof FILES)[number], Row[]>;
  bytes: Partial<Record<(typeof FILES)[number], Buffer>>;
};
export const digest = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  );
export const creatorName = (row: Row): string =>
  String(row.display_name || row.channel_name).trim();
export const creatorKey = (row: Row): string => creatorName(row).toLowerCase();
export function creatorId(key: string): string {
  const hash = digest(`streamrecorder:legacy-creator:v1:${key}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const isRow = (value: unknown): value is Row =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = ["idle", "offline", "recording", "finished", "error"];
const qualities: readonly string[] = WATCH_TARGET_QUALITIES;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

export async function inspectSnapshot(directory: string): Promise<Snapshot> {
  const report: Snapshot = {
    errors: [],
    warnings: [],
    counts: { creators: 0, watchTargets: 0, streams: 0, recordings: 0 },
    rows: {
      "watchlist.json": [],
      "streams.json": [],
      "sessions.json": [],
      "channels_status.json": [],
    },
    bytes: {},
  };
  for (const file of FILES) {
    try {
      const filename = join(directory, file);
      const metadata = await lstat(filename);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error("Expected a regular non-symlink file");
      const bytes = await readFile(filename);
      report.bytes[file] = bytes;
      const objectKeys: Set<string>[] = [];
      visit(bytes.toString("utf8"), {
        onObjectBegin: () => {
          objectKeys.push(new Set());
        },
        onObjectProperty: (key) => {
          const keys = objectKeys[objectKeys.length - 1];
          if (keys.has(key)) report.errors.push(`${file}: duplicate object key`);
          keys.add(key);
        },
        onObjectEnd: () => {
          objectKeys.pop();
        },
      });
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (file === "channels_status.json") {
        if (
          !isRow(parsed) ||
          Object.values(parsed).some((row) => !isRow(row) || !states.includes(String(row.state)))
        ) {
          throw new Error("Expected an operational status object with valid states");
        }
      } else {
        if (!Array.isArray(parsed) || !parsed.every(isRow))
          throw new Error("Expected an array of objects");
        report.rows[file] = parsed;
      }
    } catch (error) {
      if (file === "channels_status.json" && (error as NodeJS.ErrnoException).code === "ENOENT") {
        report.warnings.push(`${file}: optional operational snapshot absent`);
      } else report.errors.push(`${file}: invalid or unreadable JSON snapshot`);
    }
  }
  const targets = new Set<string>();
  const names = new Map<string, string>();
  const openStreams = new Set<string>();
  for (const file of FILES.slice(0, 3)) {
    const identifiers = new Set<string>();
    for (const [index, row] of report.rows[file].entries()) {
      const label = `${file}[${index}]`;
      const fail = (message: string): void => {
        report.errors.push(`${label}: ${message}`);
      };
      const id = row[file === "sessions.json" ? "session_id" : "id"];
      if (typeof id !== "string" || !uuid.test(id)) fail("invalid UUID");
      const normalizedId = String(id).toLowerCase();
      if (identifiers.has(normalizedId)) fail("duplicate ID");
      identifiers.add(normalizedId);
      if (file === "watchlist.json") {
        targets.add(normalizedId);
        for (const field of ["channel_name", "platform", "url", "quality"]) {
          if (typeof row[field] !== "string" || !String(row[field]).trim())
            fail(`required string ${field}`);
        }
        if (
          row.display_name !== undefined &&
          (typeof row.display_name !== "string" || !row.display_name.trim())
        )
          fail("invalid display_name");
        if (!["twitch", "youtube", "kick"].includes(String(row.platform))) fail("invalid platform");
        if (!qualities.includes(String(row.quality))) fail("unsupported quality");
        if (row.enabled !== undefined && typeof row.enabled !== "boolean")
          fail("enabled must be boolean");
        try {
          const url = new URL(String(row.url));
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            fail("unsafe URL");
        } catch {
          fail("invalid URL");
        }
        if (
          row.recording_subdir !== undefined &&
          (typeof row.recording_subdir !== "string" ||
            // Reject ASCII control characters in untrusted input; these ranges are intentional.

            row.recording_subdir.length > 255 ||
            // eslint-disable-next-line no-control-regex -- Preserve exact ASCII control rejection.
            /[\x00-\x1f\x7f:]/.test(row.recording_subdir) ||
            /^[\\/]/.test(row.recording_subdir) ||
            row.recording_subdir.split(/[\\/]/).includes(".."))
        )
          fail("unsafe recording_subdir");
        const key = creatorKey(row);
        const name = creatorName(row);
        if (names.has(key) && names.get(key) !== name)
          fail("ambiguous Creator names after normalization; resolve explicitly before backup");
        names.set(key, name);
      } else {
        const target = row[file === "streams.json" ? "watch_target_id" : "channel_id"];
        if (typeof target !== "string" || !uuid.test(target) || !targets.has(target.toLowerCase()))
          fail("orphan or invalid WatchTarget reference");
        if (!states.includes(String(row.state))) fail("invalid state");
        for (const field of ["started_at", "finished_at"]) {
          if (field === "finished_at" && (row[field] === null || row[field] === undefined))
            continue;
          if (
            typeof row[field] !== "string" ||
            !timestamp.test(String(row[field])) ||
            !isISO8601(String(row[field]), { strict: true })
          )
            fail(`invalid ${field}`);
        }
        if (file === "streams.json" && row.finished_at == null) {
          const targetKey = String(target).toLowerCase();
          if (openStreams.has(targetKey)) fail("multiple open Streams for WatchTarget");
          openStreams.add(targetKey);
        }
        if (
          file === "sessions.json" &&
          row.output_file != null &&
          typeof row.output_file !== "string"
        )
          fail("invalid output_file");
      }
    }
  }
  report.counts = {
    creators: names.size,
    watchTargets: report.rows["watchlist.json"].length,
    streams: report.rows["streams.json"].length,
    recordings: report.rows["sessions.json"].length,
  };
  report.warnings.push(
    "Legacy history retains raw timestamps and unknown Recording Stream/configuration context",
  );
  return report;
}
