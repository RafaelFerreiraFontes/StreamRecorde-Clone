import { Injectable } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import { StreamerDto } from "./dto/streamer.dto";
import { SessionDto } from "./dto/session.dto";

@Injectable()
export class StreamerService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllStreamer(): Promise<StreamerDto[]> {
    return await this.repository.findAllStreamer();
  }

  async findOneStreamer(id: string): Promise<StreamerDto> {
    return await this.repository.findOneStreamer(id);
  }

  async createStreamer(dto: StreamerDto): Promise<StreamerDto> {
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
