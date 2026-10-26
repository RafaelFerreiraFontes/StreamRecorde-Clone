import { Module } from "@nestjs/common";
import { StreamsModule } from "./streams/streams.module";
import { HealthModule } from "./health/health.module";
import { DatabaseModule } from "./database/database.module";
import { APP_PIPE } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [StreamsModule, HealthModule, DatabaseModule, AuthModule],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
  ],
})
export class AppModule {}
