/**
 * StreamsRepository — File-based repository (MVP)
 *
 * Lê/escreve três arquivos JSON gerenciados pelo worker Python:
 *   - watchlist.json      → Array<WatchlistEntry>   (streamer info + config)
 *   - channels_status.json → Record<id, ChannelStatus> (estado em tempo-real)
 *   - sessions.json       → Array<SessionEntry>     (histórico de gravações)
 *
 * Usa async-mutex para serializar os read-modify-write e evitar race conditions
 * com o worker Docker que também grava nesses mesmos arquivos.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { Mutex } from "async-mutex";
import { SessionDto } from "./dto/session.dto";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { Creator, Recording, StreamPlatform, WatchTarget } from "./domain.model";

// ─── Tipos internos (espelham o que o worker escreve) ────────────────────────

/** Uma entrada na watchlist.json (array) */
interface WatchlistEntry {
  id: string;
  display_name?: string;
  channel_name: string;
  platform: string;
  url: string;
  quality: string;
}

/** Um valor em channels_status.json (objeto indexado por channel_id) */
interface ChannelStatus {
  channel_name: string;
  platform: string;
  state: "idle" | "offline" | "recording" | "finished" | "error";
}

/** Uma entrada em sessions.json (array) */
interface SessionEntry {
  session_id: string;
  channel_id: string;
  started_at: string;
  finished_at: string | null;
  output_file: string | null;
  state: "idle" | "offline" | "recording" | "finished" | "error";
}

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

// ─── Repository ──────────────────────────────────────────────────────────────

@Injectable()
export class StreamsRepository {
  /** Mutex compartilhado para todos os arquivos — serializa leituras + escritas */
  private readonly mutex = new Mutex();

  // ── helpers de I/O ──────────────────────────────────────────────────────────

  private async readWatchlist(): Promise<WatchlistEntry[]> {
    try {
      const raw = await fs.readFile(getWatchlistPath(), "utf-8");
      return JSON.parse(raw) as WatchlistEntry[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async writeWatchlist(data: WatchlistEntry[]): Promise<void> {
    await fs.writeFile(getWatchlistPath(), JSON.stringify(data, null, 2), "utf-8");
  }

  private async readChannelsStatus(): Promise<Record<string, ChannelStatus>> {
    try {
      const raw = await fs.readFile(getChannelsStatusPath(), "utf-8");
      return JSON.parse(raw) as Record<string, ChannelStatus>;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private async readSessions(): Promise<SessionEntry[]> {
    try {
      const raw = await fs.readFile(getSessionsPath(), "utf-8");
      return JSON.parse(raw) as SessionEntry[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // ── merge helper ────────────────────────────────────────────────────────────

  private normalizeCreatorId(displayName: string): string {
    const normalized = (displayName ?? "").trim();
    return normalized || "unknown-creator";
  }

  private toCreator(entry: WatchlistEntry): Creator {
    const displayName = entry.display_name?.trim() || entry.channel_name || "unknown-creator";
    return {
      id: this.normalizeCreatorId(displayName),
      display_name: displayName,
    };
  }

  private toWatchTarget(
    entry: WatchlistEntry,
    status: Record<string, ChannelStatus>,
  ): WatchTarget {
    const creatorId = this.normalizeCreatorId(
      entry.display_name?.trim() || entry.channel_name || "unknown-creator",
    );

    return {
      id: entry.id,
      creator_id: creatorId,
      channel_name: entry.channel_name,
      platform: (entry.platform as StreamPlatform) || "youtube",
      url: entry.url ?? "",
      quality: entry.quality ?? "best",
      enabled: true,
      state: status[entry.id]?.state ?? "idle",
    };
  }

  private mergeStreamer(
    entry: WatchlistEntry,
    status: Record<string, ChannelStatus>,
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
    status: Record<string, ChannelStatus>,
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

  private legacySessionToRecording(session: SessionEntry): Recording {
    return {
      session_id: session.session_id,
      watch_target_id: session.channel_id,
      ...(session.finished_at ? { finished_at: session.finished_at } : {}),
      ...(session.output_file ? { output_file: session.output_file } : {}),
      started_at: session.started_at,
      state: session.state,
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

      const newEntry: WatchlistEntry = {
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
      const sessions = await this.readSessions();
      return sessions.map((session) => this.legacySessionToRecording(session));
    });
  }

  async findOneRecording(sessionId: string): Promise<Recording> {
    return this.mutex.runExclusive(async () => {
      const sessions = await this.readSessions();
      const session = sessions.find((entry) => entry.session_id === sessionId);
      if (!session)
        throw new NotFoundException(`Recording ${sessionId} não encontrado`);
      return this.legacySessionToRecording(session);
    });
  }

  async findRecordingsByWatchTarget(watchTargetId: string): Promise<Recording[]> {
    return this.mutex.runExclusive(async () => {
      const sessions = await this.readSessions();
      return sessions
        .filter((session) => session.channel_id === watchTargetId)
        .map((session) => this.legacySessionToRecording(session));
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
}
