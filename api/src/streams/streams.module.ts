import { Module } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import { StreamerService, SessionService } from "./streams.service";
import { StreamController } from "./streams.controller";

@Module({
  controllers: [StreamController],
  providers: [StreamsRepository, StreamerService, SessionService],
})
export class StreamsModule {}
