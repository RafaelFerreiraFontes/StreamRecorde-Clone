import { Controller, Get, NotFoundException, Optional, Param, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service";
import { RecordingService } from "./streams.service";
import { RecordingsFilesystemService } from "./recordings-filesystem.service";

@Controller("recordings")
export class RecordingsFilesystemController {
  constructor(
    private readonly filesystem: RecordingsFilesystemService,
    private readonly recordings: RecordingService,
    @Optional() private readonly authService?: AuthService,
  ) {}

  @Get("filesystem")
  async list(@Query("path") relative: unknown = "", @Req() req?: Request) {
    const principal = await this.authService?.resolvePrincipal(req?.headers?.cookie);
    if (principal?.kind === "authenticated") throw new NotFoundException();
    return this.filesystem.list(relative);
  }

  @Get(":id/location")
  async location(@Param("id") id: string, @Req() req?: Request) {
    const principal = await this.authService?.resolvePrincipal(req?.headers?.cookie);
    const recording = await this.recordings.findOneRecording(id, principal?.user?.id);
    if (principal?.kind === "authenticated") return this.filesystem.metadata(recording.output_file);
    return this.filesystem.location(recording.output_file);
  }
}
