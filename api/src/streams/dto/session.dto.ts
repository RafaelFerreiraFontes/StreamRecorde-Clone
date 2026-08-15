import {
  IsUUID,
  IsString,
  IsDateString,
  IsIn,
  IsOptional,
} from "class-validator";
import { Transform, Type } from "class-transformer";

export class SessionDto {
  @IsUUID()
  @IsString()
  session_id: string;

  @IsUUID()
  @IsString()
  channel_id: string;

  @IsDateString()
  @Type(() => Date)
  started_at: string;

  @IsDateString()
  @Type(() => Date)
  @IsOptional()
  finished_at?: string;

  @IsString()
  @IsOptional()
  output_file?: string;

  @IsIn(["idle", "offline", "recording", "finished", "error"])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "idle",
  )
  state: string;

  @IsIn(["youtube", "twitch", "offline"])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "youtube",
  )
  platform: string;
}
