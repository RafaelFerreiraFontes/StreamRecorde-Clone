import { Injectable } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { CreateWatchTargetDto } from "./dto/watch-target.dto";
import { SessionDto } from "./dto/session.dto";
import { Creator, Recording, Stream, WatchTarget } from "./domain.model";

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

  async findAllWatchTargets(): Promise<WatchTarget[]> {
    return await this.repository.findAllWatchTargets();
  }

  async findOneWatchTarget(id: string): Promise<WatchTarget> {
    return await this.repository.findOneWatchTarget(id);
  }

  async createWatchTarget(dto: CreateWatchTargetDto): Promise<WatchTarget> {
    return await this.repository.createWatchTarget(dto);
  }

  async removeWatchTarget(id: string): Promise<void> {
    return await this.repository.removeWatchTarget(id);
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

@Injectable()
export class StreamService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllStreams(): Promise<Stream[]> {
    return await this.repository.findAllStreams();
  }

  async findOneStream(id: string): Promise<Stream> {
    return await this.repository.findOneStream(id);
  }

  async findActiveStreamByWatchTarget(
    watchTargetId: string,
  ): Promise<Stream | null> {
    return await this.repository.findActiveStreamByWatchTarget(watchTargetId);
  }

  async findStreamsByWatchTarget(
    watchTargetId: string,
    since?: string,
  ): Promise<Stream[]> {
    return await this.repository.findStreamsByWatchTarget(watchTargetId, since);
  }
}

@Injectable()
export class RecordingService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllRecordings(watchTargetId?: string): Promise<Recording[]> {
    if (watchTargetId) {
      return await this.repository.findRecordingsByWatchTarget(watchTargetId);
    }
    return await this.repository.findAllRecordings();
  }

  async findOneRecording(id: string): Promise<Recording> {
    return await this.repository.findOneRecording(id);
  }
}
