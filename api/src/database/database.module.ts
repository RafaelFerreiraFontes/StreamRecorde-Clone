import { Module } from "@nestjs/common";
import { DatabaseService, DatabaseConnection } from "./database.service";

export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");

@Module({
  providers: [
    DatabaseService,
    {
      provide: DATABASE_CONNECTION,
      inject: [DatabaseService],
      useFactory: (databaseService: DatabaseService): DatabaseConnection =>
        databaseService.connection,
    },
  ],
  exports: [DatabaseService, DATABASE_CONNECTION],
})
export class DatabaseModule {}