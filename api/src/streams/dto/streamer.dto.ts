import { IsIn, IsString, IsUrl, IsUUID } from "class-validator";
import { Transform } from "class-transformer";
import sanitizeHtml from "sanitize-html";

export class StreamerDto {
  @IsUUID()
  id: string;

  @IsString()
  display_name: string;

  @IsString()
  @Transform(({ value }: { value: string }) => sanitizeHtml(value).trim())
  channel_name: string;

  @IsIn(["youtube", "twitch", "offline"])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "youtube",
  )
  platform: string;

  @IsString()
  url: string;

  @IsString()
  quality: string;

  @IsIn(["idle", "offline", "recording", "finished", "error"])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "idle",
  )
  state: string;
}

export class CreateStreamerDto {
  @IsString()
  display_name: string;

  @IsString()
  @Transform(({ value }: { value: string }) => sanitizeHtml(value).trim())
  channel_name: string;

  @IsIn(["youtube", "twitch", "kick"])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "twitch",
  )
  platform: string;

  @IsUrl()
  @IsString()
  url: string;

  @IsIn([
    "best",
    "worst",
    "source",
    "chunked",
    "1080p60",
    "720p60",
    "1080p",
    "720p",
    "480p",
    "360p",
  ])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "best",
  )
  quality: string;
}
