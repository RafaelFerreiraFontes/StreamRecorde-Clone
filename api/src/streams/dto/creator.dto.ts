import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, ValidateIf } from "class-validator";

export class CreateCreatorDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  display_name: string;
}

export class PatchCreatorDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  display_name?: string;
}

export class CreatorDto {
  id: string;
  display_name: string;
  created_at?: string;
  updated_at?: string;
}
