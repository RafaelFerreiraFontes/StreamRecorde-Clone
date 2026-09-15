import { IsOptional, IsString } from "class-validator";

export class RecordingQueryDto {
  @IsOptional()
  @IsString()
  watchTargetId?: string;
}
