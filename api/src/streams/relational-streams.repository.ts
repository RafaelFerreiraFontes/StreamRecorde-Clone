import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { isUUID } from "class-validator";
import { Mutex } from "async-mutex";
import { DatabaseService } from "../database/database.service";
import { creators, watchTargets } from "../database/schema";
import { StreamsRepository } from "./streams.repository";
import { Creator, WatchTarget } from "./domain.model";
import { CreateCreatorDto, PatchCreatorDto } from "./dto/creator.dto";
import { CreateWatchTargetDto } from "./dto/watch-target.dto";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { RuntimeStatusJsonAdapter, WatchTargetJsonAdapter, resolveAllConfigPaths } from "./json-compatibility.adapters";

@Injectable()
export class RelationalStreamsRepository extends StreamsRepository {
  private readonly configurationMutex = new Mutex();

  constructor(private readonly databaseService: DatabaseService) {
    super();
  }

  private get db() {
    return this.databaseService.connection;
  }

  private creatorView(row: typeof creators.$inferSelect): Creator {
    return { id: row.id, display_name: row.displayName };
  }

  private creatorName(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException("display_name must be a non-empty string");
    }
    return value.trim();
  }

  override async findAllCreators(): Promise<Creator[]> {
    return (await this.db.select().from(creators).where(isNull(creators.archivedAt)))
      .map(row => this.creatorView(row));
  }

  override async findOneCreator(idOrName: string): Promise<Creator> {
    const rows = await this.db.select().from(creators).where(and(
      isNull(creators.archivedAt),
      isUUID(idOrName) ? eq(creators.id, idOrName) : eq(creators.normalizedKey, idOrName.trim().toLowerCase()),
    ));
    if (!rows.length) throw new NotFoundException("Creator not found");
    if (rows.length > 1) throw new ConflictException("Ambiguous legacy Creator name; use a UUID");
    return this.creatorView(rows[0]);
  }

  override async createCreator(dto: CreateCreatorDto): Promise<Creator> {
    return this.configurationMutex.runExclusive(async () => {
      const displayName = this.creatorName(dto.display_name);
      const [row] = await this.db.insert(creators).values({
        id: randomUUID(), displayName, normalizedKey: displayName.toLowerCase(),
      }).returning();
      return this.creatorView(row);
    });
  }

  override async updateCreator(id: string, dto: PatchCreatorDto): Promise<Creator> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Creator not found");
      const displayName = dto.display_name === undefined ? undefined : this.creatorName(dto.display_name);
      const [row] = await this.db.update(creators).set({
        displayName, normalizedKey: displayName?.toLowerCase(), updatedAt: new Date(),
      }).where(and(eq(creators.id, id), isNull(creators.archivedAt))).returning();
      if (!row) throw new NotFoundException("Creator not found");
      await this.projectWatchlist();
      return this.creatorView(row);
    });
  }

  override async removeCreator(id: string): Promise<void> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Creator not found");
      await this.db.transaction(async transaction => {
        const [row] = await transaction.select().from(creators)
          .where(and(eq(creators.id, id), isNull(creators.archivedAt))).for("update");
        if (!row) throw new NotFoundException("Creator not found");
        const targets = await transaction.select({ id: watchTargets.id }).from(watchTargets)
          .where(and(eq(watchTargets.creatorId, id), isNull(watchTargets.archivedAt)));
        if (targets.length) throw new BadRequestException("Cannot delete creator with active watch targets");
        await transaction.update(creators).set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(creators.id, id));
      });
    });
  }

  private async activeTargets() {
    return this.db.select({ target: watchTargets, displayName: creators.displayName })
      .from(watchTargets).innerJoin(creators, eq(watchTargets.creatorId, creators.id))
      .where(and(isNull(watchTargets.archivedAt), isNull(creators.archivedAt)))
      .orderBy(watchTargets.createdAt, watchTargets.id);
  }

  override async findAllWatchTargets(): Promise<WatchTarget[]> {
    const [rows, statuses] = await Promise.all([
      this.activeTargets(), RuntimeStatusJsonAdapter.read(resolveAllConfigPaths(process.env).channels_status),
    ]);
    return rows.map(({ target }) => ({
      id: target.id, creator_id: target.creatorId, channel_name: target.channelName,
      platform: target.platform as WatchTarget["platform"], url: target.url,
      quality: target.quality, enabled: target.enabled,
      state: statuses[target.id]?.state ?? "idle",
      ...(target.recordingSubdir === null ? {} : { recording_subdir: target.recordingSubdir }),
    }));
  }

  override async findOneWatchTarget(id: string): Promise<WatchTarget> {
    const target = (await this.findAllWatchTargets()).find(target => target.id === id);
    if (!target) throw new NotFoundException("Watch target not found");
    return target;
  }

  override async findWatchTargetsByCreator(idOrName: string): Promise<WatchTarget[]> {
    const creator = await this.findOneCreator(idOrName);
    return (await this.findAllWatchTargets()).filter(target => target.creator_id === creator.id);
  }

  override async createWatchTarget(dto: CreateWatchTargetDto): Promise<WatchTarget> {
    return this.configurationMutex.runExclusive(async () => {
      const id = randomUUID();
      await this.db.transaction(async transaction => {
        const key = this.creatorName(dto.creator_id);
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${key.toLowerCase()}))`);
        let matches = await transaction.select().from(creators).where(and(
          isNull(creators.archivedAt),
          isUUID(key) ? eq(creators.id, key) : eq(creators.normalizedKey, key.toLowerCase()),
        )).for("update");
        if (matches.length > 1) throw new ConflictException("Ambiguous legacy Creator name; use a UUID");
        if (!matches.length) {
          if (isUUID(key)) throw new NotFoundException("Creator not found");
          matches = await transaction.insert(creators).values({
            id: randomUUID(), displayName: key, normalizedKey: key.toLowerCase(),
          }).returning();
        }
        await transaction.insert(watchTargets).values({
          id, creatorId: matches[0].id, channelName: dto.channel_name,
          platform: dto.platform, url: dto.url, quality: dto.quality,
          enabled: true, recordingSubdir: dto.recording_subdir || null,
        });
      });
      await this.projectWatchlist();
      return this.findOneWatchTarget(id);
    });
  }

  override async updateWatchTarget(id: string, patch: {
    recordingSubdir?: string; enabled?: boolean; quality?: string; url?: string;
  }): Promise<WatchTarget> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Watch target not found");
      if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") {
        throw new BadRequestException("enabled must be a boolean");
      }
      const [row] = await this.db.update(watchTargets).set({
        recordingSubdir: patch.recordingSubdir === undefined ? undefined : patch.recordingSubdir || null,
        enabled: patch.enabled, quality: patch.quality, url: patch.url, updatedAt: new Date(),
      }).where(and(eq(watchTargets.id, id), isNull(watchTargets.archivedAt))).returning();
      if (!row) throw new NotFoundException("Watch target not found");
      await this.projectWatchlist();
      return this.findOneWatchTarget(id);
    });
  }

  override async removeWatchTarget(id: string): Promise<void> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Watch target not found");
      const [row] = await this.db.update(watchTargets).set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(watchTargets.id, id), isNull(watchTargets.archivedAt))).returning();
      if (!row) throw new NotFoundException("Watch target not found");
      await this.projectWatchlist();
    });
  }

  async reprojectWatchlist(): Promise<void> {
    return this.configurationMutex.runExclusive(() => this.projectWatchlist());
  }

  private async projectWatchlist(): Promise<void> {
    try {
      const entries = (await this.activeTargets()).map(({ target, displayName }) => ({
        id: target.id, display_name: displayName, channel_name: target.channelName,
        platform: target.platform, url: target.url, quality: target.quality, enabled: target.enabled,
        ...(target.recordingSubdir === null ? {} : { recording_subdir: target.recordingSubdir }),
      }));
      await WatchTargetJsonAdapter.write(resolveAllConfigPaths(process.env).watchlist, entries);
    } catch {
      throw new InternalServerErrorException("Database committed but watchlist projection failed; run reprojectWatchlist before relying on Worker configuration");
    }
  }

  private async streamerView(target: WatchTarget): Promise<StreamerDto> {
    const creator = await this.findOneCreator(target.creator_id);
    return { id: target.id, display_name: creator.display_name, channel_name: target.channel_name,
      platform: target.platform, url: target.url, quality: target.quality, state: target.state };
  }

  override async findAllStreamer(): Promise<StreamerDto[]> {
    return Promise.all((await this.findAllWatchTargets()).map(target => this.streamerView(target)));
  }

  override async findOneStreamer(id: string): Promise<StreamerDto> {
    return this.streamerView(await this.findOneWatchTarget(id));
  }

  override async createStreamer(dto: CreateStreamerDto): Promise<StreamerDto> {
    const platform = dto.platform;
    if (platform !== "youtube" && platform !== "twitch" && platform !== "kick") {
      throw new BadRequestException("Unsupported platform");
    }
    const target = await this.createWatchTarget({
      creator_id: dto.display_name?.trim() || dto.channel_name, channel_name: dto.channel_name,
      platform, url: dto.url, quality: dto.quality ?? "best",
    });
    return this.streamerView(target);
  }

  override async removeStreamer(id: string): Promise<void> {
    return this.removeWatchTarget(id);
  }
}