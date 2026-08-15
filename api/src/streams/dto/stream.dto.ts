import { IsDateString, IsIn, IsString, IsUUID } from "class-validator";
import { Transform, Type } from "class-transformer";
import sanitizeHtml from "sanitize-html";

export class StreamDto {
  @IsUUID()
  id: string;

  @IsString()
  @Transform(({ value }: { value: string }) => sanitizeHtml(value).trim())
  channel_name: string;

  @Type(() => Date)
  @IsDateString()
  updated_at: string;

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
