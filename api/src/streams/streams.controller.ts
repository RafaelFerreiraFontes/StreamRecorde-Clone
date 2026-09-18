import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import {
  RecordingService,
  SessionService,
  StreamerService,
  StreamService,
} from "./streams.service";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { SessionDto } from "./dto/session.dto";
import { CreateWatchTargetDto, PatchRecordingSubdirDto } from "./dto/watch-target.dto";
import { RecordingQueryDto } from "./dto/recording-query.dto";
import { Creator, Recording, Stream, WatchTarget } from "./domain.model";

@Controller()
export class StreamController {
  constructor(
    private readonly streamerService: StreamerService,
    private readonly sessionService: SessionService,
    private readonly streamService: StreamService,
    private readonly recordingService: RecordingService,
  ) {}

  @Get("/creators")
  getAllCreators(): Promise<Creator[]> {
    return this.streamerService.findAllCreators();
  }

  @Get("/creators/:id")
  getCreator(@Param("id") id: string): Promise<Creator> {
    return this.streamerService.findOneCreator(id);
  }

  @Get("/creators/:id/watch-targets")
  getCreatorWatchTargets(@Param("id") id: string): Promise<WatchTarget[]> {
    return this.streamerService.findWatchTargetsByCreator(id);
  }

  @Get("/watch-targets")
  getAllWatchTargets(): Promise<WatchTarget[]> {
    return this.streamerService.findAllWatchTargets();
  }

  @Get("/watch-targets/:id")
  getWatchTarget(@Param("id") id: string): Promise<WatchTarget> {
    return this.streamerService.findOneWatchTarget(id);
  }

  @Post("/watch-targets")
  createWatchTarget(@Body() dto: CreateWatchTargetDto): Promise<WatchTarget> {
    return this.streamerService.createWatchTarget(dto);
  }

  @Delete("/watch-targets/:id")
  deleteWatchTarget(@Param("id") id: string): Promise<void> {
    return this.streamerService.removeWatchTarget(id);
  }

  /**
   * PATCH /watch-targets/:id - Update only the recording_subdir field.
   * Payload must include recording_subdir (empty string clears, undefined is no-op).
   */
  @Patch("/watch-targets/:id")
  patchWatchTarget(
    @Param("id") id: string,
    @Body() dto: PatchRecordingSubdirDto,
  ): Promise<WatchTarget> {
    return this.streamerService.updateRecordingSubdir(id, dto);
  }

  @Get("/streams")
  getAllStreams(): Promise<Stream[]> {
    return this.streamService.findAllStreams();
  }

  @Get("/streams/:id")
  getStream(@Param("id") id: string): Promise<Stream> {
    return this.streamService.findOneStream(id);
  }

  @Get("/recordings")
  getAllRecordings(@Query() query: RecordingQueryDto): Promise<Recording[]> {
    return this.recordingService.findAllRecordings(query.watchTargetId);
  }

  @Get("/recordings/:id")
  getRecording(@Param("id") id: string): Promise<Recording> {
    return this.recordingService.findOneRecording(id);
  }

  @Get("/streamer")
  getAllStreamers(): Promise<StreamerDto[]> {
    return this.streamerService.findAllStreamer();
  }

  @Get("/streamer/:id")
  getStreamer(@Param("id") id: string): Promise<StreamerDto> {
    return this.streamerService.findOneStreamer(id);
  }

  @Post("/streamer")
  createStreamer(@Body() dto: CreateStreamerDto): Promise<StreamerDto> {
    return this.streamerService.createStreamer(dto);
  }

  @Delete("/streamer/:id")
  deleteStreamer(@Param("id") id: string): Promise<void> {
    return this.streamerService.removeStreamer(id);
  }

  @Get("/session")
  getAllSessions(): Promise<SessionDto[]> {
    return this.sessionService.findAllSessions();
  }

  @Get("/session/:id")
  getSession(@Param("id") id: string): Promise<SessionDto> {
    return this.sessionService.findOneSession(id);
  }

  @Get("/session/channel/:id")
  getSessionByChannel(@Param("id") id: string): Promise<SessionDto[]> {
    return this.sessionService.findSessionsByChannel(id);
  }
}
