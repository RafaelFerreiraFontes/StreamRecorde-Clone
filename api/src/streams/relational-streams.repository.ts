import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { isUUID } from "class-validator";
import { Mutex } from "async-mutex";
import { DatabaseService } from "../database/database.service";
import {
  creators,
  watchTargets,
  streams,
  recordings,
  workerEvents,
  users,
} from "../database/schema";
import { ExecutionConfig, InternalEventDto } from "./dto/internal-event.dto";
import { StreamsRepository } from "./streams.repository";
import { Creator, WatchTarget, Stream, Recording, RecordingState } from "./domain.model";
import { SessionDto } from "./dto/session.dto";
import { CreateCreatorDto, PatchCreatorDto } from "./dto/creator.dto";
import { CreateWatchTargetDto } from "./dto/watch-target.dto";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import {
  RuntimeStatusJsonAdapter,
  WatchTargetJsonAdapter,
  resolveAllConfigPaths,
} from "./json-compatibility.adapters";

type Transaction = Parameters<Parameters<DatabaseService["connection"]["transaction"]>[0]>[0];
const activeStream = and(
  eq(streams.origin, "native"),
  isNull(streams.finishedAt),
  isNull(streams.legacyFinishedAtRaw),
);
const activeRecording = and(
  eq(recordings.origin, "native"),
  isNull(recordings.finishedAt),
  isNull(recordings.legacyFinishedAtRaw),
);
type StartInput = { startedAt?: Date | string; legacyStartedAtRaw?: string };
type FinishInput = {
  state?: RecordingState;
  finishedAt?: Date | string;
  legacyFinishedAtRaw?: string;
};
type StreamInput = StartInput & {
  id?: string;
  watchTargetId: string;
  state?: RecordingState;
  origin?: "legacy_json" | "native";
};
type RecordingInput = StreamInput &
  Partial<FinishInput> & {
    sessionId?: string;
    streamId?: string | null;
    outputFile?: string | null;
    channelName?: string;
    platform?: string;
    quality?: string;
  };

function HumanDatabaseOperation() {
  return (_target: object, _name: string, descriptor: PropertyDescriptor) => {
    const operation = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
    descriptor.value = async function (...args: unknown[]) {
      try {
        return await (operation.apply(this, args) as unknown);
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
          (error as { code?: string })?.code;
        if (code === "23505") throw new ConflictException("Resource conflict");
        if (["23503", "23514", "23502", "22P02"].includes(code ?? "")) {
          throw new BadRequestException("Invalid resource relationship or value");
        }
        throw new ServiceUnavailableException("Database unavailable");
      }
    };
  };
}

@Injectable()
export class RelationalStreamsRepository extends StreamsRepository {
  private readonly configurationMutex = new Mutex();

  constructor(private readonly databaseService: DatabaseService) {
    super();
  }

  private get db() {
    return this.databaseService.connection;
  }

  private async resolveOwnerId(ownerId?: string, client?: Transaction): Promise<string> {
    if (ownerId !== undefined) {
      if (!isUUID(ownerId)) throw new BadRequestException("Invalid owner");
      return ownerId;
    }
    return this.databaseService.resolveBootstrapLocalUser(client);
  }

  async getExecutionConfigs(): Promise<ExecutionConfig[]> {
    const rows = await this.db
      .select({ target: watchTargets })
      .from(watchTargets)
      .innerJoin(users, eq(watchTargets.ownerId, users.id))
      .where(and(isNull(watchTargets.archivedAt), isNull(users.disabledAt)));
    return rows.map(({ target: row }) => ({
      id: row.id,
      channel_name: row.channelName,
      platform: row.platform,
      url: row.url,
      quality: row.quality,
      enabled: row.enabled,
      ...(row.recordingSubdir === null ? {} : { recording_subdir: row.recordingSubdir }),
    }));
  }

  async handleWorkerEvent(
    dto: InternalEventDto,
    fingerprint: string,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${dto.event_id}, 0))`,
      );
      const [event] = await transaction
        .select()
        .from(workerEvents)
        .where(eq(workerEvents.eventId, dto.event_id));
      if (event) {
        if (event.fingerprint !== fingerprint)
          throw new ConflictException("Event ID reuse with conflicting payload");
        return event.responsePayload as Record<string, unknown>;
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${dto.watch_target_id}, 1))`,
      );
      const [target] = await transaction
        .select()
        .from(watchTargets)
        .where(eq(watchTargets.id, dto.watch_target_id))
        .for("update");
      if (!target) {
        if (dto.event_type === "recording.terminal")
          throw new ConflictException("Recording event relationship mismatch");
        throw new NotFoundException("Watch target not found");
      }
      const [owner] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, target.ownerId))
        .for("share");
      if (!owner) throw new ConflictException("Watch target owner unavailable");
      if (dto.stream_id) {
        const [referenced] = await transaction
          .select()
          .from(streams)
          .where(eq(streams.id, dto.stream_id));
        if (
          referenced &&
          (referenced.watchTargetId !== target.id || referenced.ownerId !== target.ownerId)
        ) {
          throw new ConflictException("Stream event relationship mismatch");
        }
      }
      let response: Record<string, unknown>;
      if (dto.event_type === "recording.start") {
        if (target.archivedAt) throw new NotFoundException("Watch target not found");
        if (owner.disabledAt) throw new ConflictException("Watch target owner is disabled");
        if (!target.enabled) throw new ConflictException("Watch target is disabled");
        const [active] = await transaction
          .select()
          .from(recordings)
          .where(and(eq(recordings.watchTargetId, dto.watch_target_id), activeRecording));
        if (active) throw new ConflictException("Watch target already has an active Recording");
        const stream = await this.insertStream(transaction, {
          id: dto.stream_id,
          watchTargetId: dto.watch_target_id,
          startedAt: dto.occurred_at,
        });
        const recording = await this.insertRecording(transaction, {
          sessionId: dto.session_id,
          watchTargetId: dto.watch_target_id,
          streamId: stream.id,
          startedAt: dto.occurred_at,
          quality: dto.quality,
          outputFile: dto.output_file,
        });
        response = { acknowledged: true, stream_id: stream.id, session_id: recording.session_id };
      } else if (dto.event_type === "recording.terminal") {
        const [recording] = await transaction
          .select()
          .from(recordings)
          .where(eq(recordings.id, dto.session_id!))
          .for("update");
        if (!recording)
          throw new ConflictException("Recording start must be acknowledged before terminal event");
        if (
          recording.origin !== "native" ||
          recording.ownerId !== target.ownerId ||
          recording.watchTargetId !== dto.watch_target_id ||
          (dto.stream_id && dto.stream_id !== recording.streamId)
        ) {
          throw new ConflictException("Recording event relationship mismatch");
        }
        if (recording.streamId) {
          const [stream] = await transaction
            .select()
            .from(streams)
            .where(eq(streams.id, recording.streamId));
          if (stream?.watchTargetId !== target.id || stream.ownerId !== target.ownerId) {
            throw new ConflictException("Recording Stream relationship mismatch");
          }
        }
        if (recording.finishedAt || recording.legacyFinishedAtRaw) {
          throw new ConflictException("Recording is already terminal");
        }
        if (recording.startedAt && new Date(dto.occurred_at) < recording.startedAt) {
          throw new BadRequestException("Terminal timestamp precedes start");
        }
        await this.updateRecording(transaction, recording.id, {
          state: dto.state,
          finishedAt: dto.occurred_at,
          outputFile: dto.output_file,
        });
        response = { acknowledged: true, session_id: recording.id, state: dto.state };
      } else {
        const [active] = await transaction
          .select()
          .from(recordings)
          .where(and(eq(recordings.watchTargetId, dto.watch_target_id), activeRecording));
        const [stream] = await transaction
          .select()
          .from(streams)
          .where(and(eq(streams.watchTargetId, dto.watch_target_id), activeStream));
        if (
          (active && active.ownerId !== target.ownerId) ||
          (stream && stream.ownerId !== target.ownerId)
        ) {
          throw new ConflictException("Offline event relationship mismatch");
        }
        if (dto.stream_id && stream && dto.stream_id !== stream.id)
          throw new ConflictException("Offline Stream mismatch");
        const finalized =
          !target.archivedAt &&
          !!stream &&
          !active &&
          (!stream.startedAt || new Date(dto.occurred_at) >= stream.startedAt);
        if (finalized)
          await this.updateStream(transaction, stream.id, { finishedAt: dto.occurred_at });
        response = { acknowledged: true, finalized };
      }
      await transaction.insert(workerEvents).values({
        eventId: dto.event_id,
        eventType: dto.event_type,
        fingerprint,
        responsePayload: response,
      });
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
    return {
      startedAt: this.timestamp(data.startedAt),
      legacyStartedAtRaw: data.legacyStartedAtRaw ?? null,
    };
  }

  private finishValues(data: FinishInput) {
    return {
      state: data.state ?? "finished",
      updatedAt: new Date(),
      finishedAt:
        data.finishedAt === undefined
          ? data.legacyFinishedAtRaw === undefined
            ? new Date()
            : null
          : this.timestamp(data.finishedAt),
      legacyFinishedAtRaw: data.legacyFinishedAtRaw ?? null,
    };
  }

  private streamView(row: typeof streams.$inferSelect): Stream {
    return {
      id: row.id,
      watch_target_id: row.watchTargetId,
      state: row.state as RecordingState,
      started_at: row.startedAt?.toISOString() ?? row.legacyStartedAtRaw!,
      finished_at: row.finishedAt?.toISOString() ?? row.legacyFinishedAtRaw ?? undefined,
    };
  }

  private recordingView(row: typeof recordings.$inferSelect): Recording {
    return {
      session_id: row.id,
      watch_target_id: row.watchTargetId,
      stream_id: row.streamId ?? undefined,
      state: row.state as RecordingState,
      started_at: row.startedAt?.toISOString() ?? row.legacyStartedAtRaw!,
      finished_at: row.finishedAt?.toISOString() ?? row.legacyFinishedAtRaw ?? undefined,
      output_file: row.outputFile ?? undefined,
      channel_name: row.channelName ?? undefined,
      platform: row.platform ?? undefined,
      quality: row.quality ?? undefined,
    };
  }

  @HumanDatabaseOperation()
  override async findAllStreams(ownerId?: string): Promise<Stream[]> {
    const owner = await this.resolveOwnerId(ownerId);
    return (
      await this.db
        .select()
        .from(streams)
        .where(eq(streams.ownerId, owner))
        .orderBy(desc(streams.createdAt), streams.id)
    ).map((row) => this.streamView(row));
  }

  @HumanDatabaseOperation()
  override async findOneStream(id: string, ownerId?: string): Promise<Stream> {
    if (!isUUID(id)) throw new NotFoundException("Stream not found");
    const owner = await this.resolveOwnerId(ownerId);
    const [row] = await this.db
      .select()
      .from(streams)
      .where(and(eq(streams.id, id), eq(streams.ownerId, owner)));
    if (!row) throw new NotFoundException("Stream not found");
    return this.streamView(row);
  }

  @HumanDatabaseOperation()
  async findActiveStreamByWatchTarget(
    watchTargetId: string,
    ownerId?: string,
  ): Promise<Stream | null> {
    if (!isUUID(watchTargetId)) return null;
    const owner = await this.resolveOwnerId(ownerId);
    const [row] = await this.db
      .select()
      .from(streams)
      .where(
        and(eq(streams.watchTargetId, watchTargetId), eq(streams.ownerId, owner), activeStream),
      );
    return row ? this.streamView(row) : null;
  }

  @HumanDatabaseOperation()
  async findStreamsByWatchTarget(
    watchTargetId: string,
    since?: string,
    ownerId?: string,
  ): Promise<Stream[]> {
    if (!isUUID(watchTargetId)) return [];
    const owner = await this.resolveOwnerId(ownerId);
    return (
      await this.db
        .select()
        .from(streams)
        .where(
          and(
            eq(streams.watchTargetId, watchTargetId),
            eq(streams.ownerId, owner),
            since === undefined ? undefined : gte(streams.startedAt, this.timestamp(since)),
          ),
        )
        .orderBy(desc(streams.createdAt), streams.id)
    ).map((row) => this.streamView(row));
  }

  @HumanDatabaseOperation()
  override async findAllRecordings(ownerId?: string): Promise<Recording[]> {
    const owner = await this.resolveOwnerId(ownerId);
    return (
      await this.db
        .select()
        .from(recordings)
        .where(eq(recordings.ownerId, owner))
        .orderBy(desc(recordings.createdAt), recordings.id)
    ).map((row) => this.recordingView(row));
  }

  @HumanDatabaseOperation()
  override async findOneRecording(id: string, ownerId?: string): Promise<Recording> {
    if (!isUUID(id)) throw new NotFoundException("Recording not found");
    const owner = await this.resolveOwnerId(ownerId);
    const [row] = await this.db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, id), eq(recordings.ownerId, owner)));
    if (!row) throw new NotFoundException("Recording not found");
    return this.recordingView(row);
  }

  @HumanDatabaseOperation()
  override async findRecordingsByWatchTarget(id: string, ownerId?: string): Promise<Recording[]> {
    const owner = await this.resolveOwnerId(ownerId);
    await this.requireOwnedHistoricalTarget(id, owner, "Watch target not found");
    return (
      await this.db
        .select()
        .from(recordings)
        .where(and(eq(recordings.watchTargetId, id), eq(recordings.ownerId, owner)))
        .orderBy(desc(recordings.createdAt), recordings.id)
    ).map((row) => this.recordingView(row));
  }

  private async requireOwnedHistoricalTarget(
    id: string,
    ownerId: string,
    message: string,
  ): Promise<void> {
    if (!isUUID(id)) throw new NotFoundException(message);
    const [target] = await this.db
      .select({ id: watchTargets.id })
      .from(watchTargets)
      .where(and(eq(watchTargets.id, id), eq(watchTargets.ownerId, ownerId)));
    if (!target) throw new NotFoundException(message);
  }

  private sessionView(
    recording: typeof recordings.$inferSelect,
    target: typeof watchTargets.$inferSelect | null,
  ): SessionDto & { channel_name: string } {
    const view = this.recordingView(recording);
    return {
      session_id: view.session_id,
      channel_id: view.watch_target_id,
      channel_name: recording.channelName ?? target?.channelName ?? "",
      platform: recording.platform ?? target?.platform ?? "",
      state: view.state,
      started_at: view.started_at,
      finished_at: view.finished_at,
      output_file: view.output_file,
    };
  }

  @HumanDatabaseOperation()
  override async findAllSessions(ownerId?: string): Promise<SessionDto[]> {
    const owner = await this.resolveOwnerId(ownerId);
    const rows = await this.db
      .select({ recording: recordings, target: watchTargets })
      .from(recordings)
      .leftJoin(
        watchTargets,
        and(eq(recordings.watchTargetId, watchTargets.id), eq(watchTargets.ownerId, owner)),
      )
      .where(eq(recordings.ownerId, owner))
      .orderBy(desc(recordings.createdAt), recordings.id);
    return rows.map(({ recording, target }) => this.sessionView(recording, target));
  }

  @HumanDatabaseOperation()
  override async findOneSession(id: string, ownerId?: string): Promise<SessionDto> {
    if (!isUUID(id)) throw new NotFoundException("Session not found");
    const owner = await this.resolveOwnerId(ownerId);
    const [row] = await this.db
      .select({ recording: recordings, target: watchTargets })
      .from(recordings)
      .leftJoin(
        watchTargets,
        and(eq(recordings.watchTargetId, watchTargets.id), eq(watchTargets.ownerId, owner)),
      )
      .where(and(eq(recordings.id, id), eq(recordings.ownerId, owner)));
    if (!row) throw new NotFoundException("Session not found");
    return this.sessionView(row.recording, row.target);
  }

  @HumanDatabaseOperation()
  override async findSessionsByChannel(id: string, ownerId?: string): Promise<SessionDto[]> {
    const owner = await this.resolveOwnerId(ownerId);
    await this.requireOwnedHistoricalTarget(id, owner, "Channel not found");
    const rows = await this.db
      .select({ recording: recordings, target: watchTargets })
      .from(recordings)
      .leftJoin(
        watchTargets,
        and(eq(recordings.watchTargetId, watchTargets.id), eq(watchTargets.ownerId, owner)),
      )
      .where(and(eq(recordings.watchTargetId, id), eq(recordings.ownerId, owner)))
      .orderBy(desc(recordings.createdAt), recordings.id);
    return rows.map(({ recording, target }) => this.sessionView(recording, target));
  }

  private async lockTarget(transaction: Transaction, id: string) {
    if (!isUUID(id)) throw new NotFoundException("Watch target not found");
    const [target] = await transaction
      .select()
      .from(watchTargets)
      .where(and(eq(watchTargets.id, id), isNull(watchTargets.archivedAt)))
      .for("update");
    if (!target) throw new NotFoundException("Watch target not found");
    return target;
  }

  async insertStream(transaction: Transaction, data: StreamInput): Promise<Stream> {
    const start = this.startValues(data);
    const target = await this.lockTarget(transaction, data.watchTargetId);
    const [active] = await transaction
      .select()
      .from(streams)
      .where(and(eq(streams.watchTargetId, data.watchTargetId), activeStream));
    if (active) return this.streamView(active);
    const [row] = await transaction
      .insert(streams)
      .values({
        id: data.id ?? randomUUID(),
        origin: "native",
        watchTargetId: data.watchTargetId,
        ownerId: target.ownerId,
        state: data.state ?? "recording",
        ...start,
      })
      .onConflictDoNothing({
        target: streams.watchTargetId,
        where: sql`${streams.origin} = 'native' and ${streams.finishedAt} is null and ${streams.legacyFinishedAtRaw} is null`,
      })
      .returning();
    if (row) return this.streamView(row);
    const [existing] = await transaction
      .select()
      .from(streams)
      .where(and(eq(streams.watchTargetId, data.watchTargetId), activeStream));
    if (!existing) throw new ConflictException("Active Stream changed; retry creation");
    return this.streamView(existing);
  }

  async createStream(data: StreamInput): Promise<Stream> {
    return this.db.transaction((transaction) => this.insertStream(transaction, data));
  }

  async insertRecording(transaction: Transaction, data: RecordingInput): Promise<Recording> {
    const start = this.startValues(data);
    const target = await this.lockTarget(transaction, data.watchTargetId);
    const finish =
      data.finishedAt !== undefined || data.legacyFinishedAtRaw !== undefined
        ? this.finishValues(data)
        : null;
    if (!finish) {
      const [active] = await transaction
        .select()
        .from(recordings)
        .where(and(eq(recordings.watchTargetId, data.watchTargetId), activeRecording));
      if (active) throw new ConflictException("Watch target already has an active Recording");
    }
    if (data.streamId != null) {
      if (!isUUID(data.streamId)) throw new BadRequestException("Invalid Stream ID");
      const [stream] = await transaction
        .select()
        .from(streams)
        .where(
          and(
            eq(streams.id, data.streamId),
            eq(streams.watchTargetId, data.watchTargetId),
            eq(streams.ownerId, target.ownerId),
          ),
        );
      if (!stream) throw new BadRequestException("Stream must belong to the recording WatchTarget");
    }
    if (data.id && data.sessionId && data.id !== data.sessionId)
      throw new BadRequestException("Conflicting recording IDs");
    const [row] = await transaction
      .insert(recordings)
      .values({
        id: data.id ?? data.sessionId ?? randomUUID(),
        origin: "native",
        ownerId: target.ownerId,
        watchTargetId: data.watchTargetId,
        streamId: data.streamId ?? null,
        state: finish?.state ?? data.state ?? "recording",
        ...start,
        ...(finish
          ? {
              finishedAt: finish.finishedAt,
              legacyFinishedAtRaw: finish.legacyFinishedAtRaw,
            }
          : {}),
        outputFile: data.outputFile,
        channelName: data.channelName ?? target.channelName,
        platform: data.platform ?? target.platform,
        quality: data.quality ?? target.quality,
      })
      .returning();
    return this.recordingView(row);
  }

  async createRecording(data: RecordingInput): Promise<Recording> {
    return this.db.transaction((transaction) => this.insertRecording(transaction, data));
  }

  async createStreamAndRecording(data: {
    watchTargetId: string;
    stream?: Omit<StreamInput, "watchTargetId">;
    recording: Omit<RecordingInput, "watchTargetId" | "streamId">;
  }): Promise<{ stream: Stream; recording: Recording }> {
    return this.db.transaction(async (transaction) => {
      const stream = await this.insertStream(transaction, {
        ...data.stream,
        watchTargetId: data.watchTargetId,
      });
      const recording = await this.insertRecording(transaction, {
        ...data.recording,
        watchTargetId: data.watchTargetId,
        streamId: stream.id,
      });
      return { stream, recording };
    });
  }

  async updateStream(transaction: Transaction, id: string, data: FinishInput): Promise<Stream> {
    if (!isUUID(id)) throw new NotFoundException("Stream not found");
    const [row] = await transaction
      .update(streams)
      .set(this.finishValues(data))
      .where(eq(streams.id, id))
      .returning();
    if (!row) throw new NotFoundException("Stream not found");
    return this.streamView(row);
  }

  async finalizeStream(id: string, data: FinishInput = {}): Promise<Stream> {
    return this.db.transaction((transaction) => this.updateStream(transaction, id, data));
  }

  async updateRecording(
    transaction: Transaction,
    id: string,
    data: FinishInput & { outputFile?: string },
  ): Promise<Recording> {
    if (!isUUID(id)) throw new NotFoundException("Recording not found");
    const [row] = await transaction
      .update(recordings)
      .set({ ...this.finishValues(data), outputFile: data.outputFile })
      .where(eq(recordings.id, id))
      .returning();
    if (!row) throw new NotFoundException("Recording not found");
    return this.recordingView(row);
  }

  async finalizeRecording(
    id: string,
    data: FinishInput & { outputFile?: string } = {},
  ): Promise<Recording> {
    return this.db.transaction((transaction) => this.updateRecording(transaction, id, data));
  }

  async finalizeRecordingAndStream(data: {
    recordingId: string;
    recordingState?: RecordingState;
    recordingFinishedAt?: Date | string;
    streamId?: string;
    streamState?: RecordingState;
    streamFinishedAt?: Date | string;
  }): Promise<{ recording: Recording; stream?: Stream }> {
    return this.db.transaction(async (transaction) => {
      const recording = await this.updateRecording(transaction, data.recordingId, {
        state: data.recordingState,
        finishedAt: data.recordingFinishedAt,
      });
      if (!data.streamId) return { recording };
      if (recording.stream_id !== data.streamId)
        throw new BadRequestException("Recording does not reference Stream");
      const stream = await this.updateStream(transaction, data.streamId, {
        state: data.streamState,
        finishedAt: data.streamFinishedAt,
      });
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

  @HumanDatabaseOperation()
  override async findAllCreators(ownerId?: string): Promise<Creator[]> {
    const owner = await this.resolveOwnerId(ownerId);
    return (
      await this.db
        .select()
        .from(creators)
        .where(and(eq(creators.ownerId, owner), isNull(creators.archivedAt)))
    ).map((row) => this.creatorView(row));
  }

  @HumanDatabaseOperation()
  override async findOneCreator(idOrName: string, ownerId?: string): Promise<Creator> {
    const owner = await this.resolveOwnerId(ownerId);
    const rows = await this.db
      .select()
      .from(creators)
      .where(
        and(
          eq(creators.ownerId, owner),
          isNull(creators.archivedAt),
          isUUID(idOrName)
            ? eq(creators.id, idOrName)
            : eq(creators.normalizedKey, idOrName.trim().toLowerCase()),
        ),
      );
    if (!rows.length) throw new NotFoundException("Creator not found");
    if (rows.length > 1) throw new ConflictException("Ambiguous legacy Creator name; use a UUID");
    return this.creatorView(rows[0]);
  }

  @HumanDatabaseOperation()
  override async createCreator(dto: CreateCreatorDto, ownerId?: string): Promise<Creator> {
    return this.configurationMutex.runExclusive(async () => {
      const displayName = this.creatorName(dto.display_name);
      const owner = await this.resolveOwnerId(ownerId);
      const [row] = await this.db
        .insert(creators)
        .values({
          id: randomUUID(),
          ownerId: owner,
          displayName,
          normalizedKey: displayName.toLowerCase(),
        })
        .returning();
      return this.creatorView(row);
    });
  }

  @HumanDatabaseOperation()
  override async updateCreator(
    id: string,
    dto: PatchCreatorDto,
    ownerId?: string,
  ): Promise<Creator> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Creator not found");
      const displayName =
        dto.display_name === undefined ? undefined : this.creatorName(dto.display_name);
      const owner = await this.resolveOwnerId(ownerId);
      const [row] = await this.db
        .update(creators)
        .set({
          displayName,
          normalizedKey: displayName?.toLowerCase(),
          updatedAt: new Date(),
        })
        .where(and(eq(creators.id, id), eq(creators.ownerId, owner), isNull(creators.archivedAt)))
        .returning();
      if (!row) throw new NotFoundException("Creator not found");
      await this.projectWatchlist();
      return this.creatorView(row);
    });
  }

  @HumanDatabaseOperation()
  override async removeCreator(id: string, ownerId?: string): Promise<void> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Creator not found");
      await this.db.transaction(async (transaction) => {
        const owner = await this.resolveOwnerId(ownerId, transaction);
        const [row] = await transaction
          .select()
          .from(creators)
          .where(and(eq(creators.id, id), eq(creators.ownerId, owner), isNull(creators.archivedAt)))
          .for("update");
        if (!row) throw new NotFoundException("Creator not found");
        const targets = await transaction
          .select({ id: watchTargets.id })
          .from(watchTargets)
          .where(
            and(
              eq(watchTargets.creatorId, id),
              eq(watchTargets.ownerId, owner),
              isNull(watchTargets.archivedAt),
            ),
          );
        if (targets.length)
          throw new BadRequestException("Cannot delete creator with active watch targets");
        await transaction
          .update(creators)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(
            and(eq(creators.id, id), eq(creators.ownerId, owner), isNull(creators.archivedAt)),
          );
      });
    });
  }

  private async activeTargets(ownerId: string, id?: string, creatorId?: string) {
    return this.db
      .select({ target: watchTargets, displayName: creators.displayName })
      .from(watchTargets)
      .innerJoin(creators, eq(watchTargets.creatorId, creators.id))
      .where(
        and(
          eq(watchTargets.ownerId, ownerId),
          eq(creators.ownerId, ownerId),
          isNull(watchTargets.archivedAt),
          isNull(creators.archivedAt),
          id === undefined ? undefined : eq(watchTargets.id, id),
          creatorId === undefined ? undefined : eq(watchTargets.creatorId, creatorId),
        ),
      )
      .orderBy(watchTargets.createdAt, watchTargets.id);
  }

  private async targetViews(
    rows: Awaited<ReturnType<RelationalStreamsRepository["activeTargets"]>>,
  ): Promise<WatchTarget[]> {
    const statuses = await RuntimeStatusJsonAdapter.read(
      resolveAllConfigPaths(process.env).channels_status,
    );
    return rows.map(({ target }) => this.targetView(target, statuses[target.id]?.state ?? "idle"));
  }

  private targetView(
    target: typeof watchTargets.$inferSelect,
    state: WatchTarget["state"],
  ): WatchTarget {
    return {
      id: target.id,
      creator_id: target.creatorId,
      channel_name: target.channelName,
      platform: target.platform as WatchTarget["platform"],
      url: target.url,
      quality: target.quality,
      enabled: target.enabled,
      state,
      ...(target.recordingSubdir === null ? {} : { recording_subdir: target.recordingSubdir }),
    };
  }

  @HumanDatabaseOperation()
  override async findAllWatchTargets(ownerId?: string): Promise<WatchTarget[]> {
    const owner = await this.resolveOwnerId(ownerId);
    return this.targetViews(await this.activeTargets(owner));
  }

  @HumanDatabaseOperation()
  override async findOneWatchTarget(id: string, ownerId?: string): Promise<WatchTarget> {
    if (!isUUID(id)) throw new NotFoundException("Watch target not found");
    const owner = await this.resolveOwnerId(ownerId);
    const rows = await this.activeTargets(owner, id);
    if (!rows.length) throw new NotFoundException("Watch target not found");
    return (await this.targetViews(rows))[0];
  }

  @HumanDatabaseOperation()
  override async findWatchTargetsByCreator(
    idOrName: string,
    ownerId?: string,
  ): Promise<WatchTarget[]> {
    const owner = await this.resolveOwnerId(ownerId);
    const creator = await this.findOneCreator(idOrName, owner);
    return this.targetViews(await this.activeTargets(owner, undefined, creator.id));
  }

  @HumanDatabaseOperation()
  override async createWatchTarget(
    dto: CreateWatchTargetDto,
    ownerId?: string,
  ): Promise<WatchTarget> {
    return this.configurationMutex.runExclusive(async () => {
      const id = randomUUID();
      let owner: string;
      await this.db.transaction(async (transaction) => {
        const key = this.creatorName(dto.creator_id);
        owner = await this.resolveOwnerId(ownerId, transaction);
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${owner + ":" + key.toLowerCase()}))`,
        );
        let matches = await transaction
          .select()
          .from(creators)
          .where(
            and(
              eq(creators.ownerId, owner),
              isNull(creators.archivedAt),
              isUUID(key) ? eq(creators.id, key) : eq(creators.normalizedKey, key.toLowerCase()),
            ),
          )
          .for("update");
        if (matches.length > 1)
          throw new ConflictException("Ambiguous legacy Creator name; use a UUID");
        if (!matches.length) {
          if (isUUID(key)) throw new NotFoundException("Creator not found");
          matches = await transaction
            .insert(creators)
            .values({
              id: randomUUID(),
              ownerId: owner,
              displayName: key,
              normalizedKey: key.toLowerCase(),
            })
            .returning();
        }
        await transaction.insert(watchTargets).values({
          id,
          ownerId: matches[0].ownerId,
          creatorId: matches[0].id,
          channelName: dto.channel_name,
          platform: dto.platform,
          url: dto.url,
          quality: dto.quality,
          enabled: true,
          recordingSubdir: dto.recording_subdir || null,
        });
      });
      await this.projectWatchlist();
      return this.findOneWatchTarget(id, owner!);
    });
  }

  @HumanDatabaseOperation()
  override async updateWatchTarget(
    id: string,
    patch: {
      recordingSubdir?: string;
      enabled?: boolean;
      quality?: string;
      url?: string;
    },
    ownerId?: string,
  ): Promise<WatchTarget> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Watch target not found");
      if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") {
        throw new BadRequestException("enabled must be a boolean");
      }
      const owner = await this.resolveOwnerId(ownerId);
      const [row] = await this.db
        .update(watchTargets)
        .set({
          recordingSubdir:
            patch.recordingSubdir === undefined ? undefined : patch.recordingSubdir || null,
          enabled: patch.enabled,
          quality: patch.quality,
          url: patch.url,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(watchTargets.id, id),
            eq(watchTargets.ownerId, owner),
            isNull(watchTargets.archivedAt),
          ),
        )
        .returning();
      if (!row) throw new NotFoundException("Watch target not found");
      await this.projectWatchlist();
      return this.findOneWatchTarget(id, owner);
    });
  }

  @HumanDatabaseOperation()
  override async removeWatchTarget(id: string, ownerId?: string): Promise<void> {
    return this.configurationMutex.runExclusive(async () => {
      if (!isUUID(id)) throw new NotFoundException("Watch target not found");
      const owner = await this.resolveOwnerId(ownerId);
      const [row] = await this.db
        .update(watchTargets)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(watchTargets.id, id),
            eq(watchTargets.ownerId, owner),
            isNull(watchTargets.archivedAt),
          ),
        )
        .returning();
      if (!row) throw new NotFoundException("Watch target not found");
      await this.projectWatchlist();
    });
  }

  async reprojectWatchlist(): Promise<void> {
    return this.configurationMutex.runExclusive(() => this.projectWatchlist());
  }

  private async projectWatchlist(): Promise<void> {
    if (process.env.PERSISTENCE_MODE === "bridge") return;
    try {
      const rows = await this.db
        .select({ target: watchTargets, displayName: creators.displayName })
        .from(watchTargets)
        .innerJoin(creators, eq(watchTargets.creatorId, creators.id))
        .where(and(isNull(watchTargets.archivedAt), isNull(creators.archivedAt)))
        .orderBy(watchTargets.createdAt, watchTargets.id);
      const entries = rows.map(({ target, displayName }) => ({
        id: target.id,
        display_name: displayName,
        channel_name: target.channelName,
        platform: target.platform,
        url: target.url,
        quality: target.quality,
        enabled: target.enabled,
        ...(target.recordingSubdir === null ? {} : { recording_subdir: target.recordingSubdir }),
      }));
      await WatchTargetJsonAdapter.write(resolveAllConfigPaths(process.env).watchlist, entries);
    } catch {
      throw new InternalServerErrorException(
        "Database committed but watchlist projection failed; run reprojectWatchlist before relying on Worker configuration",
      );
    }
  }

  private async streamerView(target: WatchTarget, ownerId: string): Promise<StreamerDto> {
    const creator = await this.findOneCreator(target.creator_id, ownerId);
    return {
      id: target.id,
      display_name: creator.display_name,
      channel_name: target.channel_name,
      platform: target.platform,
      url: target.url,
      quality: target.quality,
      state: target.state,
    };
  }

  @HumanDatabaseOperation()
  override async findAllStreamer(ownerId?: string): Promise<StreamerDto[]> {
    const owner = await this.resolveOwnerId(ownerId);
    return Promise.all(
      (await this.findAllWatchTargets(owner)).map((target) => this.streamerView(target, owner)),
    );
  }

  @HumanDatabaseOperation()
  override async findOneStreamer(id: string, ownerId?: string): Promise<StreamerDto> {
    const owner = await this.resolveOwnerId(ownerId);
    return this.streamerView(await this.findOneWatchTarget(id, owner), owner);
  }

  @HumanDatabaseOperation()
  override async createStreamer(dto: CreateStreamerDto, ownerId?: string): Promise<StreamerDto> {
    const owner = await this.resolveOwnerId(ownerId);
    const platform = dto.platform;
    if (platform !== "youtube" && platform !== "twitch" && platform !== "kick") {
      throw new BadRequestException("Unsupported platform");
    }
    const target = await this.createWatchTarget(
      {
        creator_id: dto.display_name?.trim() || dto.channel_name,
        channel_name: dto.channel_name,
        platform,
        url: dto.url,
        quality: dto.quality ?? "best",
      },
      owner,
    );
    return this.streamerView(target, owner);
  }

  @HumanDatabaseOperation()
  override async removeStreamer(id: string, ownerId?: string): Promise<void> {
    return this.removeWatchTarget(id, await this.resolveOwnerId(ownerId));
  }
}
