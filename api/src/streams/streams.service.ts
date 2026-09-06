import { Injectable } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { SessionDto } from "./dto/session.dto";
import { Creator, WatchTarget } from "./domain.model";

@Injectable()
export class StreamerService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllCreators(): Promise<Creator[]> {
    return await this.repository.findAllCreators();
  }

  async findOneCreator(creatorId: string): Promise<Creator> {
    return await this.repository.findOneCreator(creatorId);
  }

  async findWatchTargetsByCreator(creatorId: string): Promise<WatchTarget[]> {
    return await this.repository.findWatchTargetsByCreator(creatorId);
  }

  async findAllStreamer(): Promise<StreamerDto[]> {
    return await this.repository.findAllStreamer();
  }

  async findOneStreamer(id: string): Promise<StreamerDto> {
    return await this.repository.findOneStreamer(id);
  }

  async createStreamer(dto: CreateStreamerDto): Promise<StreamerDto> {
    return await this.repository.createStreamer(dto);
  }

  async removeStreamer(id: string) {
    return await this.repository.removeStreamer(id);
  }
}

@Injectable()
export class SessionService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllSessions(): Promise<SessionDto[]> {
    return await this.repository.findAllSessions();
  }

  async findOneSession(id: string): Promise<SessionDto> {
    return await this.repository.findOneSession(id);
  }

  async findSessionsByChannel(channel_id: string): Promise<SessionDto[]> {
    return await this.repository.findSessionsByChannel(channel_id);
  }
}
