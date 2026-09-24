import { Module } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import {
  RecordingService,
  StreamerService,
  SessionService,
  StreamService,
} from "./streams.service";
import { StreamController } from "./streams.controller";

import { RecordingsFilesystemService } from "./recordings-filesystem.service";
import { RecordingsFilesystemController } from "./recordings-filesystem.controller";

@Module({
  controllers: [RecordingsFilesystemController, StreamController],
  providers: [
    RecordingsFilesystemService,
    StreamsRepository,
    StreamerService,
    SessionService,
    StreamService,
    RecordingService,
  ],
})
export class StreamsModule {}
