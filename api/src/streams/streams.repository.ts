/**
 * StreamsRepository — File-based repository (MVP)
 *
 * JSON compatibility adapters isolate the worker-owned file formats from the
 * repository's domain operations. The mutex serializes Node read-modify-write
 * operations only; it does not synchronize the separate Python worker process.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
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
} from "./json-compatibility.adapters";

type WatchlistEntries = Awaited<ReturnType<typeof WatchTargetJsonAdapter.read>>;
type RuntimeStatuses = Awaited<
  ReturnType<typeof RuntimeStatusJsonAdapter.read>
>;

interface SessionWithChannel extends SessionDto {
  channel_name: string | null;
}

// ─── Caminhos dos arquivos ────────────────────────────────────────────────────

const getConfigDir = (): string =>
  process.env.CONFIG_DIR ?? path.join(process.cwd(), "..", "worker", "config");

const getWatchlistPath = (): string =>
  process.env.WATCHLIST_PATH ?? path.join(getConfigDir(), "watchlist.json");

const getChannelsStatusPath = (): string =>
  process.env.CHANNELS_STATUS_PATH ??
  path.join(getConfigDir(), "channels_status.json");

const getSessionsPath = (): string =>
  process.env.SESSIONS_PATH ?? path.join(getConfigDir(), "sessions.json");

const getStreamsPath = (): string =>
  process.env.STREAMS_PATH ?? path.join(getConfigDir(), "streams.json");

// ─── Repository ──────────────────────────────────────────────────────────────

@Injectable()
export class StreamsRepository {
  /** Serializes read-modify-write operations inside this Node process only. */
  private readonly mutex = new Mutex();

  // ── helpers de I/O ──────────────────────────────────────────────────────────

  private async readWatchlist(): Promise<WatchlistEntries> {
    return WatchTargetJsonAdapter.read(getWatchlistPath());
  }

  private async writeWatchlist(data: WatchlistEntries): Promise<void> {
    await WatchTargetJsonAdapter.write(getWatchlistPath(), data);
  }

  private async readChannelsStatus(): Promise<RuntimeStatuses> {
    return RuntimeStatusJsonAdapter.read(getChannelsStatusPath());
  }

  private async readSessions(): Promise<Recording[]> {
    return RecordingJsonAdapter.read(getSessionsPath());
  }

  private async readStreams(): Promise<Stream[]> {
    return StreamJsonAdapter.read(getStreamsPath());
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
        throw new NotFoundException(`Creator ${creatorId} não encontrado`);
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
   * Retorna todos os streamers da watchlist com o estado atual de cada um.
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
   * Retorna um streamer pelo id (watchlist + status merged).
   * Lança NotFoundException se não existir na watchlist.
   */
  async findOneStreamer(id: string): Promise<StreamerDto> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);
      const entry = watchlist.find((e) => e.id === id);
      if (!entry) throw new NotFoundException(`Streamer ${id} não encontrado`);
      return this.mergeStreamer(entry, status);
    });
  }

  /**
   * Cria uma nova entrada na watchlist (gera uuid v4) e persiste.
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
   * Remove um streamer da watchlist pelo id e persiste.
   * Lança NotFoundException se não existir.
   */
  async removeStreamer(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const watchlist = await this.readWatchlist();
      const idx = watchlist.findIndex((e) => e.id === id);
      if (idx === -1)
        throw new NotFoundException(`Streamer ${id} não encontrado`);
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
        throw new NotFoundException(`Recording ${sessionId} não encontrado`);
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
   * Retorna todas as sessões de gravação enriquecidas com info do canal.
   */
  async findAllSessions(): Promise<SessionDto[]> {
    const [recordings, status] = await Promise.all([
      this.findAllRecordings(),
      this.readChannelsStatus(),
    ]);
    return recordings.map((recording) => this.mergeSession(recording, status));
  }

  /**
   * Retorna uma sessão pelo session_id.
   * Lança NotFoundException se não existir.
   */
  async findOneSession(sessionId: string): Promise<SessionDto> {
    const [recording, status] = await Promise.all([
      this.findOneRecording(sessionId),
      this.readChannelsStatus(),
    ]);
    return this.mergeSession(recording, status);
  }

  /**
   * Retorna todas as sessões de um canal específico (channel_id).
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
   * Retorna todos os streams.
   */
  async findAllStreams(): Promise<Stream[]> {
    return this.mutex.runExclusive(async () => {
      return this.readStreams();
    });
  }

  /**
   * Retorna o stream ativo (não finalizado) para um watch target.
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
   * Retorna todos os streams finalizados para um watch target dentro de uma janela de tempo.
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
