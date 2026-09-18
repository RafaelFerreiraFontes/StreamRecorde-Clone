/**
 * StreamsRepository — File-based repository (MVP)
 *
 * JSON compatibility adapters isolate the worker-owned file formats from the
 * repository's domain operations. The mutex serializes Node read-modify-write
 * operations only; it does not synchronize the separate Python worker process.
 */

import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import * as path from "path";
import { randomUUID } from "crypto";
import { Mutex } from "async-mutex";
import { SessionDto } from "./dto/session.dto";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { CreateWatchTargetDto } from "./dto/watch-target.dto";
import { Creator, Recording, Stream, WatchTarget } from "./domain.model";
import {
  RecordingJsonAdapter,
  RuntimeStatusJsonAdapter,
  StreamJsonAdapter,
  WatchTargetJsonAdapter,
  resolveAllConfigPaths,
  resolveConfigPath,
} from "./json-compatibility.adapters";

type WatchlistEntries = Awaited<ReturnType<typeof WatchTargetJsonAdapter.read>>;
type RuntimeStatuses = Awaited<
  ReturnType<typeof RuntimeStatusJsonAdapter.read>
>;

interface SessionWithChannel extends SessionDto {
  channel_name: string | null;
}

// ─── Path resolution using shared resolver ────────────────────────────────────

/**
 * Resolve all config paths for the repository.
 * Uses NON-EMPTY individual > NON-EMPTY CONFIG_DIR > local default precedence.
 */
function getConfigPaths() {
  return resolveAllConfigPaths(process.env);
}

// ── Repository I/O helpers using resolved paths ───────────────────────────────

@Injectable()
export class StreamsRepository {
  /** Serializes read-modify-write operations inside this Node process only. */
  private readonly mutex = new Mutex();

  private getPaths() {
    return getConfigPaths();
  }

  private async readWatchlist(): Promise<WatchlistEntries> {
    return WatchTargetJsonAdapter.read(this.getPaths().watchlist);
  }

  private async writeWatchlist(data: WatchlistEntries): Promise<void> {
    await WatchTargetJsonAdapter.write(this.getPaths().watchlist, data);
  }

  private async readChannelsStatus(): Promise<RuntimeStatuses> {
    return RuntimeStatusJsonAdapter.read(this.getPaths().channels_status);
  }

  private async readSessions(): Promise<Recording[]> {
    return RecordingJsonAdapter.read(this.getPaths().sessions);
  }

  private async readStreams(): Promise<Stream[]> {
    return StreamJsonAdapter.read(this.getPaths().streams);
  }

  // ── merge helper ────────────────────────────────────────────────────────────

  private normalizeCreatorId(displayName: string): string {
    const normalized = (displayName ?? "").trim();
    return normalized || "unknown-creator";
  }

  private toCreator(entry: WatchlistEntries[number]): Creator {
    const displayName =
      entry.display_name?.trim() || entry.channel_name || "unknown-creator";
    return {
      id: this.normalizeCreatorId(displayName),
      display_name: displayName,
    };
  }

  private toWatchTarget(
    entry: WatchlistEntries[number],
    status: RuntimeStatuses,
  ): WatchTarget {
    return WatchTargetJsonAdapter.toDomain(
      entry,
      status[entry.id]?.state ?? "idle",
    );
  }

  private mergeStreamer(
    entry: WatchlistEntries[number],
    status: RuntimeStatuses,
  ): StreamerDto {
    const channelStatus = status[entry.id];
    return {
      id: entry.id,
      display_name: entry.display_name ?? "",
      channel_name: entry.channel_name,
      platform: entry.platform,
      url: entry.url ?? "",
      quality: entry.quality ?? "",
      state: channelStatus?.state ?? "idle",
    };
  }

  private mergeSession(
    recording: Recording,
    status: RuntimeStatuses,
  ): SessionWithChannel {
    const channelStatus = status[recording.watch_target_id];
    return {
      session_id: recording.session_id,
      channel_id: recording.watch_target_id,
      channel_name: channelStatus?.channel_name ?? "",
      platform: channelStatus?.platform ?? "",
      started_at: recording.started_at || "",
      finished_at: recording.finished_at || "",
      output_file: recording.output_file || "",
      state: recording.state || "idle",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Streamer methods  (watchlist.json + channels_status.json merged by id)
  // ═══════════════════════════════════════════════════════════════════════════

  async findAllCreators(): Promise<Creator[]> {
    return this.mutex.runExclusive(async () => {
      const watchlist = await this.readWatchlist();
      const creators = new Map<string, Creator>();

      for (const entry of watchlist) {
        const creator = this.toCreator(entry);
        if (!creators.has(creator.id)) {
          creators.set(creator.id, creator);
        }
      }

      return Array.from(creators.values());
    });
  }

  async findOneCreator(creatorId: string): Promise<Creator> {
    return this.mutex.runExclusive(async () => {
      const watchlist = await this.readWatchlist();
      const entry = watchlist.find(
        (item) =>
          this.toCreator(item).id === creatorId ||
          this.toCreator(item).display_name === creatorId,
      );

      if (!entry) {
        throw new NotFoundException(`Creator ${creatorId} not found`);
      }

      return this.toCreator(entry);
    });
  }

  async findWatchTargetsByCreator(creatorId: string): Promise<WatchTarget[]> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);

      return watchlist
        .filter((entry) => {
          const creator = this.toCreator(entry);
          return creator.id === creatorId || creator.display_name === creatorId;
        })
        .map((entry) => this.toWatchTarget(entry, status));
    });
  }

  async findAllWatchTargets(): Promise<WatchTarget[]> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      return watchlist.map((entry) => this.toWatchTarget(entry, status));
    });
  }

  async findOneWatchTarget(id: string): Promise<WatchTarget> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      const entry = watchlist.find((item) => item.id === id);
      if (!entry) throw new NotFoundException(`Watch target ${id} not found`);
      return this.toWatchTarget(entry, status);
    });
  }

  async createWatchTarget(dto: CreateWatchTargetDto): Promise<WatchTarget> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      const watchTarget: WatchTarget = {
        id: randomUUID(),
        creator_id: dto.creator_id,
        channel_name: dto.channel_name,
        platform: dto.platform,
        url: dto.url,
        quality: dto.quality,
        enabled: true,
        state: "idle",
        recording_subdir: dto.recording_subdir,
      };

      watchlist.push(WatchTargetJsonAdapter.fromDomain(watchTarget));
      await this.writeWatchlist(watchlist);
      return this.toWatchTarget(
        WatchTargetJsonAdapter.fromDomain(watchTarget),
        status,
      );
    });
  }

  async removeWatchTarget(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const watchlist = await this.readWatchlist();
      const index = watchlist.findIndex((entry) => entry.id === id);
      if (index === -1)
        throw new NotFoundException(`Watch target ${id} not found`);
      watchlist.splice(index, 1);
      await this.writeWatchlist(watchlist);
    });
  }

  /**
   * Update only the recording_subdir field of a watch target.
   * PATCH semantics: field must be present in payload.
   * Empty string clears the override (restores legacy fallback).
   * Returns the updated watch target.
   *
   * Note: Invalid values (absolute, traversal, etc.) should be rejected at the
   * controller/DTO level. Repository handles the delete (undefined) vs clear (empty).
   */
  async updateRecordingSubdir(
    id: string,
    recordingSubdir: string | undefined,
  ): Promise<WatchTarget> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      const index = watchlist.findIndex((entry) => entry.id === id);
      if (index === -1)
        throw new NotFoundException(`Watch target ${id} not found`);

      const entry = watchlist[index];
      // Empty string -> delete the field (clear override)
      // Undefined -> no-op (field not present in payload)
      // Non-empty string -> set the normalized value
      if (recordingSubdir !== undefined) {
        if (recordingSubdir === "") {
          // Clear the override - delete the property
          delete entry.recording_subdir;
        } else {
          entry.recording_subdir = recordingSubdir;
        }
      }
      // If undefined, keep existing value (no-op)
      await this.writeWatchlist(watchlist);
      return this.toWatchTarget(entry, status);
    });
  }

  /**
   * Returns all streamers from the watchlist with current state of each.
   */
  async findAllStreamer(): Promise<StreamerDto[]> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      return watchlist.map((entry) => this.mergeStreamer(entry, status));
    });
  }

  /**
   * Returns a streamer by id (watchlist + status merged).
   * Throws NotFoundException if not found in watchlist.
   */
  async findOneStreamer(id: string): Promise<StreamerDto> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      const entry = watchlist.find((e) => e.id === id);
      if (!entry) throw new NotFoundException(`Streamer ${id} not found`);
      return this.mergeStreamer(entry, status);
    });
  }

  /**
   * Creates a new entry in the watchlist (generates uuid v4) and persists.
   */
  async createStreamer(dto: CreateStreamerDto): Promise<StreamerDto> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);

      const newEntry: WatchlistEntries[number] = {
        id: randomUUID(),
        display_name: dto.display_name ?? "",
        channel_name: dto.channel_name,
        platform: dto.platform,
        url: dto.url,
        quality: dto.quality ?? "best",
      };

      watchlist.push(newEntry);
      await this.writeWatchlist(watchlist);

      return this.mergeStreamer(newEntry, status);
    });
  }

  /**
   * Removes a streamer from the watchlist by id and persists.
   * Throws NotFoundException if not found.
   */
  async removeStreamer(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const watchlist = await this.readWatchlist();
      const idx = watchlist.findIndex((e) => e.id === id);
      if (idx === -1)
        throw new NotFoundException(`Streamer ${id} not found`);
      watchlist.splice(idx, 1);
      await this.writeWatchlist(watchlist);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Recording methods (sessions.json mapped to the internal Recording shape)
  // ═══════════════════════════════════════════════════════════════════════════

  async findAllRecordings(): Promise<Recording[]> {
    return this.mutex.runExclusive(async () => {
      return this.readSessions();
    });
  }

  async findOneRecording(sessionId: string): Promise<Recording> {
    return this.mutex.runExclusive(async () => {
      const sessions = await this.readSessions();
      const session = sessions.find((entry) => entry.session_id === sessionId);
      if (!session)
        throw new NotFoundException(`Recording ${sessionId} not found`);
      return session;
    });
  }

  async findRecordingsByWatchTarget(
    watchTargetId: string,
  ): Promise<Recording[]> {
    return this.mutex.runExclusive(async () => {
      const sessions = await this.readSessions();
      return sessions.filter(
        (session) => session.watch_target_id === watchTargetId,
      );
    });
  }

  // Legacy Session methods (sessions.json + channels_status.json compatibility)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns all recording sessions enriched with channel info.
   */
  async findAllSessions(): Promise<SessionDto[]> {
    const [recordings, status] = await Promise.all([
      this.findAllRecordings(),
      this.readChannelsStatus(),
    ]);
    return recordings.map((recording) => this.mergeSession(recording, status));
  }

  /**
   * Returns a session by session_id.
   * Throws NotFoundException if not found.
   */
  async findOneSession(sessionId: string): Promise<SessionDto> {
    const [recording, status] = await Promise.all([
      this.findOneRecording(sessionId),
      this.readChannelsStatus(),
    ]);
    return this.mergeSession(recording, status);
  }

  /**
   * Returns all sessions for a specific channel (channel_id).
   */
  async findSessionsByChannel(channelId: string): Promise<SessionDto[]> {
    const [recordings, status] = await Promise.all([
      this.findRecordingsByWatchTarget(channelId),
      this.readChannelsStatus(),
    ]);
    return recordings.map((recording) => this.mergeSession(recording, status));
  }

  // Stream methods (streams.json)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns all streams.
   */
  async findAllStreams(): Promise<Stream[]> {
    return this.mutex.runExclusive(async () => {
      return this.readStreams();
    });
  }

  /**
   * Returns the active (not finalized) stream for a watch target.
   */
  async findActiveStreamByWatchTarget(
    watchTargetId: string,
  ): Promise<Stream | null> {
    return this.mutex.runExclusive(async () => {
      const streams = await this.readStreams();
      return (
        streams.find(
          (s) => s.watch_target_id === watchTargetId && !s.finished_at,
        ) ?? null
      );
    });
  }

  /**
   * Returns all finalized streams for a watch target within a time window.
   */
  async findStreamsByWatchTarget(
    watchTargetId: string,
    since?: string,
  ): Promise<Stream[]> {
    return this.mutex.runExclusive(async () => {
      const streams = await this.readStreams();
      return streams.filter((s) => {
        if (s.watch_target_id !== watchTargetId) return false;
        if (since && s.started_at < since) return false;
        return true;
      });
    });
  }

  async findOneStream(id: string): Promise<Stream> {
    return this.mutex.runExclusive(async () => {
      const streams = await this.readStreams();
      const stream = streams.find((entry) => entry.id === id);
      if (!stream) throw new NotFoundException(`Stream ${id} not found`);
      return stream;
    });
  }
}
