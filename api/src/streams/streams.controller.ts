import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Optional,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import {
  RecordingService,
  SessionService,
  StreamerService,
  StreamService,
} from "./streams.service";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { SessionDto } from "./dto/session.dto";
import { CreateWatchTargetDto, PatchWatchTargetDto } from "./dto/watch-target.dto";
import { RecordingQueryDto } from "./dto/recording-query.dto";
import { CreateCreatorDto, PatchCreatorDto } from "./dto/creator.dto";
import { Creator, Recording, Stream, WatchTarget } from "./domain.model";

@Controller()
export class StreamController {
  constructor(
    private readonly streamerService: StreamerService,
    private readonly sessionService: SessionService,
    private readonly streamService: StreamService,
    private readonly recordingService: RecordingService,
    @Optional() private readonly authService?: AuthService,
  ) {}

  private async ownerId(req?: Request, unsafe = false): Promise<string | undefined> {
    const principal = await this.authService?.resolvePrincipal(req?.headers?.cookie);
    if (unsafe && principal?.kind === "authenticated") {
      this.authService!.requireUnsafeOrigin(req?.headers ?? {});
    }
    return principal?.user?.id;
  }

  @Get("/creators")
  async getAllCreators(@Req() req?: Request): Promise<Creator[]> {
    return this.streamerService.findAllCreators(await this.ownerId(req));
  }

  @Post("/creators")
  async createCreator(@Body() dto: CreateCreatorDto, @Req() req?: Request): Promise<Creator> {
    return this.streamerService.createCreator(dto, await this.ownerId(req, true));
  }

  @Patch("/creators/:id")
  async patchCreator(
    @Param("id") id: string,
    @Body() dto: PatchCreatorDto,
    @Req() req?: Request,
  ): Promise<Creator> {
    return this.streamerService.updateCreator(id, dto, await this.ownerId(req, true));
  }

  @Delete("/creators/:id")
  async deleteCreator(@Param("id") id: string, @Req() req?: Request): Promise<void> {
    return this.streamerService.removeCreator(id, await this.ownerId(req, true));
  }

  @Get("/creators/:id")
  async getCreator(@Param("id") id: string, @Req() req?: Request): Promise<Creator> {
    return this.streamerService.findOneCreator(id, await this.ownerId(req));
  }

  @Get("/creators/:id/watch-targets")
  async getCreatorWatchTargets(
    @Param("id") id: string,
    @Req() req?: Request,
  ): Promise<WatchTarget[]> {
    return this.streamerService.findWatchTargetsByCreator(id, await this.ownerId(req));
  }

  @Get("/watch-targets")
  async getAllWatchTargets(@Req() req?: Request): Promise<WatchTarget[]> {
    return this.streamerService.findAllWatchTargets(await this.ownerId(req));
  }

  @Get("/watch-targets/:id")
  async getWatchTarget(@Param("id") id: string, @Req() req?: Request): Promise<WatchTarget> {
    return this.streamerService.findOneWatchTarget(id, await this.ownerId(req));
  }

  @Post("/watch-targets")
  async createWatchTarget(
    @Body() dto: CreateWatchTargetDto,
    @Req() req?: Request,
  ): Promise<WatchTarget> {
    return this.streamerService.createWatchTarget(dto, await this.ownerId(req, true));
  }

  @Delete("/watch-targets/:id")
  async deleteWatchTarget(@Param("id") id: string, @Req() req?: Request): Promise<void> {
    return this.streamerService.removeWatchTarget(id, await this.ownerId(req, true));
  }

  /**
   * PATCH /watch-targets/:id - Update enabled, recording_subdir, and/or url.
   * Omitted fields are unchanged; an empty recording_subdir clears its override.
   */
  @Patch("/watch-targets/:id")
  async patchWatchTarget(
    @Param("id") id: string,
    @Body() dto: PatchWatchTargetDto,
    @Req() req?: Request,
  ): Promise<WatchTarget> {
    return this.streamerService.updateWatchTarget(id, dto, await this.ownerId(req, true));
  }

  @Get("/streams")
  async getAllStreams(@Req() req?: Request): Promise<Stream[]> {
    return this.streamService.findAllStreams(await this.ownerId(req));
  }

  @Get("/streams/:id")
  async getStream(@Param("id") id: string, @Req() req?: Request): Promise<Stream> {
    return this.streamService.findOneStream(id, await this.ownerId(req));
  }

  @Get("/recordings")
  async getAllRecordings(
    @Query() query: RecordingQueryDto,
    @Req() req?: Request,
  ): Promise<Recording[]> {
    return this.recordingService.findAllRecordings(query.watchTargetId, await this.ownerId(req));
  }

  @Get("/recordings/:id")
  async getRecording(@Param("id") id: string, @Req() req?: Request): Promise<Recording> {
    return this.recordingService.findOneRecording(id, await this.ownerId(req));
  }

  @Get("/streamer")
  async getAllStreamers(@Req() req?: Request): Promise<StreamerDto[]> {
    return this.streamerService.findAllStreamer(await this.ownerId(req));
  }

  @Get("/streamer/:id")
  async getStreamer(@Param("id") id: string, @Req() req?: Request): Promise<StreamerDto> {
    return this.streamerService.findOneStreamer(id, await this.ownerId(req));
  }

  @Post("/streamer")
  async createStreamer(@Body() dto: CreateStreamerDto, @Req() req?: Request): Promise<StreamerDto> {
    return this.streamerService.createStreamer(dto, await this.ownerId(req, true));
  }

  @Delete("/streamer/:id")
  async deleteStreamer(@Param("id") id: string, @Req() req?: Request): Promise<void> {
    return this.streamerService.removeStreamer(id, await this.ownerId(req, true));
  }

  @Get("/session")
  async getAllSessions(@Req() req?: Request): Promise<SessionDto[]> {
    return this.sessionService.findAllSessions(await this.ownerId(req));
  }

  @Get("/session/:id")
  async getSession(@Param("id") id: string, @Req() req?: Request): Promise<SessionDto> {
    return this.sessionService.findOneSession(id, await this.ownerId(req));
  }

  @Get("/session/channel/:id")
  async getSessionByChannel(@Param("id") id: string, @Req() req?: Request): Promise<SessionDto[]> {
    return this.sessionService.findSessionsByChannel(id, await this.ownerId(req));
  }
}
