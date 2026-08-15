import { IsIn, IsString, IsUUID } from "class-validator";
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
  state: string;
}
