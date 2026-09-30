import { IsIn, IsString, IsUrl, IsOptional, IsBoolean, ValidateIf } from "class-validator";
import { Transform } from "class-transformer";
import { normalizeTextInput } from "../sanitize";

export const WATCH_TARGET_QUALITIES = [
  "best", "worst", "source", "chunked",
  "1080p60", "720p60", "1080p", "720p", "480p", "360p", "160p",
] as const;

export class CreateWatchTargetDto {
  @IsString()
  @Transform(({ value }: { value: string }) => normalizeTextInput(value))
  creator_id: string;

  @IsString()
  @Transform(({ value }: { value: string }) => normalizeTextInput(value))
  channel_name: string;

  @IsIn(["youtube", "twitch", "kick"])
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "twitch",
  )
  platform: "youtube" | "twitch" | "kick";

  @IsUrl()
  @IsString()
  url: string;

  @IsIn(WATCH_TARGET_QUALITIES)
  @IsString()
  @Transform(
    ({ value }: { value: string }) => value.toLowerCase().trim() || "best",
  )
  quality: string;

  /**
   * Optional relative subdirectory for recordings.
   * Must be a safe relative path (no traversal, no absolute paths).
   * Example: "twitch/pixelcarvel"
   */
  @IsOptional()
  @IsString()
  recording_subdir?: string;
}

export class PatchWatchTargetDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "recording_subdir must be a string" })
  recording_subdir?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsIn(WATCH_TARGET_QUALITIES)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase().trim() : value,
  )
  quality?: string;
}
