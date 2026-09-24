import { Controller, Get, Param, Query } from "@nestjs/common";
import { RecordingService } from "./streams.service";
import { RecordingsFilesystemService } from "./recordings-filesystem.service";

@Controller("recordings")
export class RecordingsFilesystemController {
  constructor(
    private readonly filesystem: RecordingsFilesystemService,
    private readonly recordings: RecordingService,
  ) {}

  @Get("filesystem")
  list(@Query("path") relative: unknown = "") {
    return this.filesystem.list(relative);
  }

  @Get(":id/location")
  async location(@Param("id") id: string) {
    const recording = await this.recordings.findOneRecording(id);
    return this.filesystem.location(recording.output_file);
  }
}
