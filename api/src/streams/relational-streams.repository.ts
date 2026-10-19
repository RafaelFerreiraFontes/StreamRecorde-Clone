import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { isUUID } from "class-validator";
import { Mutex } from "async-mutex";
import { DatabaseService } from "../database/database.service";
import { creators, watchTargets, streams, recordings, workerEvents } from "../database/schema";
import { ExecutionConfig, InternalEventDto } from "./dto/internal-event.dto";
import { StreamsRepository } from "./streams.repository";
import { Creator, WatchTarget, Stream, Recording, RecordingState } from "./domain.model";
import { SessionDto } from "./dto/session.dto";
import { CreateCreatorDto, PatchCreatorDto } from "./dto/creator.dto";
import { CreateWatchTargetDto } from "./dto/watch-target.dto";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { RuntimeStatusJsonAdapter, WatchTargetJsonAdapter, resolveAllConfigPaths } from "./json-compatibility.adapters";

type Transaction = Parameters<Parameters<DatabaseService["connection"]["transaction"]>[0]>[0];
type StartInput = { startedAt?: Date | string; legacyStartedAtRaw?: string };
type FinishInput = { state?: RecordingState; finishedAt?: Date | string; legacyFinishedAtRaw?: string };
type StreamInput = StartInput & { id?: string; watchTargetId: string; state?: RecordingState };
type RecordingInput = StreamInput & { sessionId?: string; streamId?: string | null; outputFile?: string | null;
  channelName?: string; platform?: string; quality?: string };

@Injectable()
export class RelationalStreamsRepository extends StreamsRepository {
  private readonly configurationMutex = new Mutex();

  constructor(private readonly databaseService: DatabaseService) {
    super();
  }

  private get db() {
    return this.databaseService.connection;
  }

  async getExecutionConfigs(): Promise<ExecutionConfig[]> {
    const rows = await this.db.select().from(watchTargets).where(isNull(watchTargets.archivedAt));
    return rows.map(row => ({ id: row.id, channel_name: row.channelName, platform: row.platform,
      url: row.url, quality: row.quality, enabled: row.enabled,
      ...(row.recordingSubdir === null ? {} : { recording_subdir: row.recordingSubdir }) }));
  }

  async handleWorkerEvent(dto: InternalEventDto, fingerprint: string): Promise<Record<string, unknown>> {
    return this.db.transaction(async transaction => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${dto.event_id}, 0))`);
      const [event] = await transaction.select().from(workerEvents).where(eq(workerEvents.eventId, dto.event_id));
      if (event) {
        if (event.fingerprint !== fingerprint) throw new ConflictException("Event ID reuse with conflicting payload");
        return event.responsePayload as Record<string, unknown>;
      }
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${dto.watch_target_id}, 1))`);
      let response: Record<string, unknown>;
      if (dto.event_type === "recording.start") {
        const target = await this.lockTarget(transaction, dto.watch_target_id);
        if (!target.enabled) throw new ConflictException("Watch target is disabled");
        const [active] = await transaction.select().from(recordings).where(and(
          eq(recordings.watchTargetId, dto.watch_target_id), isNull(recordings.finishedAt), isNull(recordings.legacyFinishedAtRaw)));
        if (active) throw new ConflictException("Watch target already has an active Recording");
        const stream = await this.insertStream(transaction, { id: dto.stream_id,
          watchTargetId: dto.watch_target_id, startedAt: dto.occurred_at });
        const recording = await this.insertRecording(transaction, { sessionId: dto.session_id,
          watchTargetId: dto.watch_target_id, streamId: stream.id, startedAt: dto.occurred_at,
          quality: dto.quality, outputFile: dto.output_file });
        response = { acknowledged: true, stream_id: stream.id, session_id: recording.session_id };
      } else if (dto.event_type === "recording.terminal") {
        const [recording] = await transaction.select().from(recordings).where(eq(recordings.id, dto.session_id!)).for("update");
        if (!recording) throw new ConflictException("Recording start must be acknowledged before terminal event");
        if (recording.watchTargetId !== dto.watch_target_id || (dto.stream_id && dto.stream_id !== recording.streamId)) {
          throw new ConflictException("Recording event relationship mismatch");
        }
        if (recording.finishedAt || recording.legacyFinishedAtRaw) {
          throw new ConflictException("Recording is already terminal");
        }
        if (recording.startedAt && new Date(dto.occurred_at) < recording.startedAt) {
          throw new BadRequestException("Terminal timestamp precedes start");
        }
        await this.updateRecording(transaction, recording.id, { state: dto.state,
          finishedAt: dto.occurred_at, outputFile: dto.output_file });
        response = { acknowledged: true, session_id: recording.id, state: dto.state };
      } else {
        const [active] = await transaction.select().from(recordings).where(and(
          eq(recordings.watchTargetId, dto.watch_target_id), isNull(recordings.finishedAt), isNull(recordings.legacyFinishedAtRaw)));
        const [stream] = await transaction.select().from(streams).where(and(
          eq(streams.watchTargetId, dto.watch_target_id), isNull(streams.finishedAt), isNull(streams.legacyFinishedAtRaw)));
        if (dto.stream_id && stream && dto.stream_id !== stream.id) throw new ConflictException("Offline Stream mismatch");
        const finalized = !!stream && !active && (!stream.startedAt || new Date(dto.occurred_at) >= stream.startedAt);
        if (finalized) await this.updateStream(transaction, stream.id, { finishedAt: dto.occurred_at });
        response = { acknowledged: true, finalized };
      }
      await transaction.insert(workerEvents).values({ eventId: dto.event_id, eventType: dto.event_type,
        fingerprint, responsePayload: response });
      return response;
    });
  }

  private timestamp(value: Date | string): Date {
    if (typeof value === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new BadRequestException("Timestamp must include an explicit timezone");
    }
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new BadRequestException("Invalid timestamp");
    return instant;
  }

  private startValues(data: StartInput) {
    if (data.startedAt === undefined) {
      throw new BadRequestException("startedAt is required");
    }
    return { startedAt: this.timestamp(data.startedAt),
      legacyStartedAtRaw: data.legacyStartedAtRaw ?? null };
  }

  private finishValues(data: FinishInput) {
    return { state: data.state ?? "finished", updatedAt: new Date(),
      finishedAt: data.finishedAt === undefined ? (data.legacyFinishedAtRaw === undefined ? new Date() : null) : this.timestamp(data.finishedAt),
      legacyFinishedAtRaw: data.legacyFinishedAtRaw ?? null };
  }

  private streamView(row: typeof streams.$inferSelect): Stream {
    return { id: row.id, watch_target_id: row.watchTargetId, state: row.state as RecordingState,
      started_at: row.startedAt?.toISOString() ?? row.legacyStartedAtRaw!,
      finished_at: row.finishedAt?.toISOString() ?? row.legacyFinishedAtRaw ?? undefined };
  }

  private recordingView(row: typeof recordings.$inferSelect): Recording {
    return { session_id: row.id, watch_target_id: row.watchTargetId, stream_id: row.streamId ?? undefined,
      state: row.state as RecordingState, started_at: row.startedAt?.toISOString() ?? row.legacyStartedAtRaw!,
      finished_at: row.finishedAt?.toISOString() ?? row.legacyFinishedAtRaw ?? undefined,
      output_file: row.outputFile ?? undefined, channel_name: row.channelName ?? undefined,
      platform: row.platform ?? undefined, quality: row.quality ?? undefined };
  }

  override async findAllStreams(): Promise<Stream[]> {
    return (await this.db.select().from(streams).orderBy(desc(streams.createdAt), streams.id)).map(row => this.streamView(row));
  }

  override async findOneStream(id: string): Promise<Stream> {
    if (!isUUID(id)) throw new NotFoundException("Stream not found");
    const [row] = await this.db.select().from(streams).where(eq(streams.id, id));
    if (!row) throw new NotFoundException("Stream not found");
    return this.streamView(row);
  }

  async findActiveStreamByWatchTarget(watchTargetId: string): Promise<Stream | null> {
    if (!isUUID(watchTargetId)) return null;
    const [row] = await this.db.select().from(streams).where(and(eq(streams.watchTargetId, watchTargetId),
      isNull(streams.finishedAt), isNull(streams.legacyFinishedAtRaw)));
    return row ? this.streamView(row) : null;
  }

  async findStreamsByWatchTarget(watchTargetId: string, since?: string): Promise<Stream[]> {
    if (!isUUID(watchTargetId)) return [];
    return (await this.db.select().from(streams).where(and(eq(streams.watchTargetId, watchTargetId),
      since === undefined ? undefined : gte(streams.startedAt, this.timestamp(since))))
      .orderBy(desc(streams.createdAt), streams.id)).map(row => this.streamView(row));
  }

  override async findAllRecordings(): Promise<Recording[]> {
    return (await this.db.select().from(recordings).orderBy(desc(recordings.createdAt), recordings.id)).map(row => this.recordingView(row));
  }

  override async findOneRecording(id: string): Promise<Recording> {
    if (!isUUID(id)) throw new NotFoundException("Recording not found");
    const [row] = await this.db.select().from(recordings).where(eq(recordings.id, id));
    if (!row) throw new NotFoundException("Recording not found");
    return this.recordingView(row);
  }

  override async findRecordingsByWatchTarget(id: string): Promise<Recording[]> {
    if (!isUUID(id)) return [];
    return (await this.db.select().from(recordings).where(eq(recordings.watchTargetId, id))
      .orderBy(desc(recordings.createdAt), recordings.id)).map(row => this.recordingView(row));
  }

  override async findAllSessions(): Promise<SessionDto[]> {
    const rows = await this.db.select({ recording: recordings, target: watchTargets }).from(recordings)
      .leftJoin(watchTargets, eq(recordings.watchTargetId, watchTargets.id)).orderBy(desc(recordings.createdAt), recordings.id);
    return rows.map(({ recording, target }) => {
      const view = this.recordingView(recording);
      return { session_id: view.session_id, channel_id: view.watch_target_id,
        channel_name: recording.channelName ?? target?.channelName ?? "",
        platform: recording.platform ?? target?.platform ?? "", state: view.state,
        started_at: view.started_at, finished_at: view.finished_at, output_file: view.output_file };
    });
  }

  override async findOneSession(id: string): Promise<SessionDto> {
    const session = (await this.findAllSessions()).find(row => row.session_id === id);
    if (!session) throw new NotFoundException("Session not found");
    return session;
  }

  override async findSessionsByChannel(id: string): Promise<SessionDto[]> {
    return (await this.findAllSessions()).filter(row => row.channel_id === id);
  }

  private async lockTarget(transaction: Transaction, id: string) {
    if (!isUUID(id)) throw new NotFoundException("Watch target not found");
    const [target] = await transaction.select().from(watchTargets)
      .where(and(eq(watchTargets.id, id), isNull(watchTargets.archivedAt))).for("update");
    if (!target) throw new NotFoundException("Watch target not found");
    return target;
  }

  async insertStream(transaction: Transaction, data: StreamInput): Promise<Stream> {
    const start = this.startValues(data);
    await this.lockTarget(transaction, data.watchTargetId);
    const [active] = await transaction.select().from(streams).where(and(eq(streams.watchTargetId, data.watchTargetId),
      isNull(streams.finishedAt), isNull(streams.legacyFinishedAtRaw)));
    if (active) return this.streamView(active);
    const [row] = await transaction.insert(streams).values({ id: data.id ?? randomUUID(), watchTargetId: data.watchTargetId,
      state: data.state ?? "recording", ...start }).onConflictDoNothing({ target: streams.watchTargetId,
        where: sql`${streams.finishedAt} is null and ${streams.legacyFinishedAtRaw} is null` }).returning();
    if (row) return this.streamView(row);
    const [existing] = await transaction.select().from(streams).where(and(eq(streams.watchTargetId, data.watchTargetId),
      isNull(streams.finishedAt), isNull(streams.legacyFinishedAtRaw)));
    if (!existing) throw new ConflictException("Active Stream changed; retry creation");
    return this.streamView(existing);
  }

  async createStream(data: StreamInput): Promise<Stream> {
    return this.db.transaction(transaction => this.insertStream(transaction, data));
  }

  async insertRecording(transaction: Transaction, data: RecordingInput): Promise<Recording> {
    const start = this.startValues(data);
    const target = await this.lockTarget(transaction, data.watchTargetId);
    if (data.streamId != null) {
      if (!isUUID(data.streamId)) throw new BadRequestException("Invalid Stream ID");
      const [stream] = await transaction.select().from(streams).where(and(eq(streams.id, data.streamId), eq(streams.watchTargetId, data.watchTargetId)));
      if (!stream) throw new BadRequestException("Stream must belong to the recording WatchTarget");
    }
    if (data.id && data.sessionId && data.id !== data.sessionId) throw new BadRequestException("Conflicting recording IDs");
    const [row] = await transaction.insert(recordings).values({ id: data.id ?? data.sessionId ?? randomUUID(),
      watchTargetId: data.watchTargetId, streamId: data.streamId ?? null, state: data.state ?? "recording", ...start,
      outputFile: data.outputFile, channelName: data.channelName ?? target.channelName,
      platform: data.platform ?? target.platform, quality: data.quality ?? target.quality }).returning();
    return this.recordingView(row);
  }

  async createRecording(data: RecordingInput): Promise<Recording> {
    return this.db.transaction(transaction => this.insertRecording(transaction, data));
  }

  async createStreamAndRecording(data: { watchTargetId: string; stream?: Omit<StreamInput, "watchTargetId">;
    recording: Omit<RecordingInput, "watchTargetId" | "streamId"> }): Promise<{ stream: Stream; recording: Recording }> {
    return this.db.transaction(async transaction => {
      const stream = await this.insertStream(transaction, { ...data.stream, watchTargetId: data.watchTargetId });
      const recording = await this.insertRecording(transaction, { ...data.recording, watchTargetId: data.watchTargetId, streamId: stream.id });
      return { stream, recording };
    });
  }

  async updateStream(transaction: Transaction, id: string, data: FinishInput): Promise<Stream> {
    if (!isUUID(id)) throw new NotFoundException("Stream not found");
    const [row] = await transaction.update(streams).set(this.finishValues(data)).where(eq(streams.id, id)).returning();
    if (!row) throw new NotFoundException("Stream not found");
    return this.streamView(row);
  }

  async finalizeStream(id: string, data: FinishInput = {}): Promise<Stream> {
    return this.db.transaction(transaction => this.updateStream(transaction, id, data));
  }

  async updateRecording(transaction: Transaction, id: string, data: FinishInput & { outputFile?: string }): Promise<Recording> {
    if (!isUUID(id)) throw new NotFoundException("Recording not found");
    const [row] = await transaction.update(recordings).set({ ...this.finishValues(data), outputFile: data.outputFile })
      .where(eq(recordings.id, id)).returning();
    if (!row) throw new NotFoundException("Recording not found");
    return this.recordingView(row);
  }

  async finalizeRecording(id: string, data: FinishInput & { outputFile?: string } = {}): Promise<Recording> {
    return this.db.transaction(transaction => this.updateRecording(transaction, id, data));
  }

  async finalizeRecordingAndStream(data: { recordingId: string; recordingState?: RecordingState; recordingFinishedAt?: Date | string;
    streamId?: string; streamState?: RecordingState; streamFinishedAt?: Date | string }): Promise<{ recording: Recording; stream?: Stream }> {
    return this.db.transaction(async transaction => {
      const recording = await this.updateRecording(transaction, data.recordingId, { state: data.recordingState, finishedAt: data.recordingFinishedAt });
      if (!data.streamId) return { recording };
      if (recording.stream_id !== data.streamId) throw new BadRequestException("Recording does not reference Stream");
      const stream = await this.updateStream(transaction, data.streamId, { state: data.streamState, finishedAt: data.streamFinishedAt });
      return { recording, stream };
    });
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