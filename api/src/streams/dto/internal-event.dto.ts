import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

export class InternalEventDto {
  @IsUUID()
  event_id!: string;

  @IsIn(["recording.start", "recording.terminal", "stream.offline"])
  event_type!: "recording.start" | "recording.terminal" | "stream.offline";

  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i)
  occurred_at!: string;

  @IsUUID()
  watch_target_id!: string;

  @ValidateIf(
    (value: InternalEventDto) =>
      value.event_type !== "stream.offline" || value.session_id !== undefined,
  )
  @IsUUID()
  session_id?: string;

  @IsOptional()
  @IsUUID()
  stream_id?: string;

  @ValidateIf(
    (value: InternalEventDto) =>
      value.event_type === "recording.terminal" || value.state !== undefined,
  )
  @IsIn(["finished", "error"])
  state?: "finished" | "error";

  @IsOptional()
  @IsString()
  @MaxLength(64)
  quality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  output_file?: string;

  @IsOptional()
  @IsIn(["worker_restart_interruption", "launch_failure", "checkpoint_failure"])
  reason?: string;
}

export type ExecutionConfig = {
  id: string;
  channel_name: string;
  platform: string;
  url: string;
  quality: string;
  enabled: boolean;
  recording_subdir?: string;
};
