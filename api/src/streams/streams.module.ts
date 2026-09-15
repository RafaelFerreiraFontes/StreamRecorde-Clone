import { Module } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import {
  RecordingService,
  StreamerService,
  SessionService,
  StreamService,
} from "./streams.service";
import { StreamController } from "./streams.controller";

@Module({
  controllers: [StreamController],
  providers: [
    StreamsRepository,
    StreamerService,
    SessionService,
    StreamService,
    RecordingService,
  ],
})
export class StreamsModule {}
