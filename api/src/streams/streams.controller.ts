import { Controller, Get, Post, Delete, Param, Body } from "@nestjs/common";
import { StreamerService, SessionService } from "./streams.service";
import { StreamerDto } from "./dto/streamer.dto";
import { SessionDto } from "./dto/session.dto";

@Controller()
export class StreamController {
  constructor(
    private readonly streamerService: StreamerService,
    private readonly sessionService: SessionService,
  ) {}

  @Get("/streamer")
  getAllStreamers(): Promise<StreamerDto[]> {
    return this.streamerService.findAllStreamer();
  }

  @Get("/streamer/:id")
  getStreamer(@Param("id") id: string): Promise<StreamerDto> {
    return this.streamerService.findOneStreamer(id);
  }

  @Post("/streamer")
  createStreamer(@Body() dto: StreamerDto): Promise<StreamerDto> {
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
  getSessionByChannel(@Param("channel_id") id: string): Promise<SessionDto[]> {
    return this.sessionService.findSessionsByChannel(id);
  }
}
