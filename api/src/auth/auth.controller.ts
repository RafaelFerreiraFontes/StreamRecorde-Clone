import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { identitySummary } from "./principal";
import { sessionCookie } from "./session-cookie";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get("session")
  async session(@Req() request: Request) {
    return identitySummary(await this.auth.resolvePrincipal(request.headers.cookie));
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body, request.headers, request.socket.remoteAddress ?? "unknown", request.headers.cookie);
    response.setHeader("Set-Cookie", sessionCookie(result.token, result.origin));
    return { identityMode: "authenticated", persistence: "relational", user: result.user };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const origin = await this.auth.logout(request.headers, request.headers.cookie);
    response.setHeader("Set-Cookie", sessionCookie("", origin, true));
    return { loggedOut: true };
  }
}