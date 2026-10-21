import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AUTH_OPTIONS, AuthService } from "./auth.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, { provide: AUTH_OPTIONS, useValue: {} }],
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply((_request: Request, response: Response, next: NextFunction) => {
      response.setHeader("Cache-Control", "no-store");
      next();
    }).forRoutes(AuthController);
  }
}