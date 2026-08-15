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
import { v4 as uuidv4 } from "uuid";
import { Mutex } from "async-mutex";
import { SessionDto } from "./dto/session.dto";
import { StreamerDto } from "./dto/streamer.dto";

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

const CONFIG_DIR: string =
  (process.env.CONFIG_DIR ??
    path.join(process.cwd(), "..", "worker", "config")) ||
  "";

const WATCHLIST_PATH: string =
  (process.env.WATCHLIST_PATH ?? path.join(CONFIG_DIR, "watchlist.json")) || "";
const CHANNELS_STATUS_PATH: string =
  (process.env.CHANNELS_STATUS_PATH ??
    path.join(CONFIG_DIR, "channels_status.json")) ||
  "";
const SESSIONS_PATH: string =
  (process.env.SESSIONS_PATH ?? path.join(CONFIG_DIR, "sessions.json")) || "";

// ─── Repository ──────────────────────────────────────────────────────────────

@Injectable()
export class StreamsRepository {
  /** Mutex compartilhado para todos os arquivos — serializa leituras + escritas */
  private readonly mutex = new Mutex();

  // ── helpers de I/O ──────────────────────────────────────────────────────────

  private async readWatchlist(): Promise<WatchlistEntry[]> {
    try {
      const raw = await fs.readFile(WATCHLIST_PATH, "utf-8");
      return JSON.parse(raw) as WatchlistEntry[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async writeWatchlist(data: WatchlistEntry[]): Promise<void> {
    await fs.writeFile(WATCHLIST_PATH, JSON.stringify(data, null, 2), "utf-8");
  }

  private async readChannelsStatus(): Promise<Record<string, ChannelStatus>> {
    try {
      const raw = await fs.readFile(CHANNELS_STATUS_PATH, "utf-8");
      return JSON.parse(raw) as Record<string, ChannelStatus>;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private async readSessions(): Promise<SessionEntry[]> {
    try {
      const raw = await fs.readFile(SESSIONS_PATH, "utf-8");
      return JSON.parse(raw) as SessionEntry[];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // ── merge helper ────────────────────────────────────────────────────────────

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
    session: SessionEntry,
    status: Record<string, ChannelStatus>,
  ): SessionWithChannel {
    const channelStatus = status[session.channel_id];
    return {
      session_id: session.session_id,
      channel_id: session.channel_id,
      channel_name: channelStatus?.channel_name ?? "",
      platform: channelStatus?.platform ?? "",
      started_at: session.started_at || "",
      finished_at: session.finished_at || "",
      output_file: session.output_file || "",
      state: session.state || "idle",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Streamer methods  (watchlist.json + channels_status.json merged by id)
  // ═══════════════════════════════════════════════════════════════════════════

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
  async createStreamer(dto: StreamerDto): Promise<StreamerDto> {
    return this.mutex.runExclusive(async () => {
      const [watchlist, status] = await Promise.all([
        this.readWatchlist(),
        this.readChannelsStatus(),
      ]);

      const newEntry: WatchlistEntry = {
        id: uuidv4(),
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
  // Session methods  (sessions.json + channels_status.json for channel info)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retorna todas as sessões de gravação enriquecidas com info do canal.
   */
  async findAllSessions(): Promise<SessionDto[]> {
    return this.mutex.runExclusive(async () => {
      const [sessions, status] = await Promise.all([
        this.readSessions(),
        this.readChannelsStatus(),
      ]);
      return sessions.map((s) => this.mergeSession(s, status));
    });
  }

  /**
   * Retorna uma sessão pelo session_id.
   * Lança NotFoundException se não existir.
   */
  async findOneSession(sessionId: string): Promise<SessionDto> {
    return this.mutex.runExclusive(async () => {
      const [sessions, status] = await Promise.all([
        this.readSessions(),
        this.readChannelsStatus(),
      ]);
      const session = sessions.find((s) => s.session_id === sessionId);
      if (!session)
        throw new NotFoundException(`Sessão ${sessionId} não encontrada`);
      return this.mergeSession(session, status);
    });
  }

  /**
   * Retorna todas as sessões de um canal específico (channel_id).
   */
  async findSessionsByChannel(channelId: string): Promise<SessionDto[]> {
    return this.mutex.runExclusive(async () => {
      const [sessions, status] = await Promise.all([
        this.readSessions(),
        this.readChannelsStatus(),
      ]);
      return sessions
        .filter((s) => s.channel_id === channelId)
        .map((s) => this.mergeSession(s, status));
    });
  }
}
