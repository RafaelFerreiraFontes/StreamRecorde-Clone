import { Module } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import { RelationalStreamsRepository } from "./relational-streams.repository";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseService } from "../database/database.service";
import {
  RecordingService,
  StreamerService,
  SessionService,
  StreamService,
} from "./streams.service";
import { StreamController } from "./streams.controller";

import { RecordingsFilesystemService } from "./recordings-filesystem.service";
import { RecordingsFilesystemController } from "./recordings-filesystem.controller";
import { InternalStreamsController, InternalTokenGuard } from "./internal-streams.controller";
import { InternalEventsService } from "./internal-events.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecordingsFilesystemController, StreamController, InternalStreamsController],
  providers: [
    InternalEventsService,
    InternalTokenGuard,
    RecordingsFilesystemService,
    {
      provide: StreamsRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        process.env.RELATIONAL_STORAGE === "true"
          ? new RelationalStreamsRepository(database)
          : new StreamsRepository(),
    },
    StreamerService,
    SessionService,
    StreamService,
    RecordingService,
  ],
})
export class StreamsModule {}
