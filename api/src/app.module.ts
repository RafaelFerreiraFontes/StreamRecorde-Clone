import { Module } from "@nestjs/common";
import { StreamsModule } from "./streams/streams.module";
import { APP_PIPE } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";

@Module({
  imports: [StreamsModule],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
  ],
})
export class AppModule {}
