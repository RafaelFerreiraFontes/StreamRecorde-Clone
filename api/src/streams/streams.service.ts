import { Injectable, BadRequestException } from "@nestjs/common";
import { isURL } from "class-validator";
import { StreamsRepository } from "./streams.repository";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import {
  CreateWatchTargetDto,
  PatchWatchTargetDto,
  WATCH_TARGET_QUALITIES,
  WATCH_TARGET_URL_OPTIONS,
} from "./dto/watch-target.dto";
import { SessionDto } from "./dto/session.dto";
import { CreateCreatorDto, PatchCreatorDto } from "./dto/creator.dto";
import { Creator, Recording, Stream, WatchTarget } from "./domain.model";

/**
 * Validate recording_subdir input and throw BadRequestException for invalid values.
 * Returns normalized value or undefined for empty/absent.
 *
 * Security rules applied BEFORE normalization:
 * 1. Reject non-string values explicitly
 * 2. Reject null bytes and control characters
 * 3. Reject absolute paths (leading / or \) BEFORE stripping
 * 4. Reject UNC paths
 * 5. Reject traversal segments (. or ..) in raw input - NOT every name with a dot
 *
 * Then normalize:
 * - Convert separators to forward slash
 * - Collapse multiple slashes
 * - Remove trailing slashes (leading already rejected above)
 * - Check for Windows drive letters after normalization
 * - Max 255 chars
 */
function validateRecordingSubdirInput(
  value: unknown,
  fieldName = "recording_subdir",
): string | undefined {
  if (value === undefined || value === null) return undefined;

  // Reject non-string values explicitly - do not coerce
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string`);
  }

  const str = value;

  // Check for null/control characters before any processing
  // Reject ASCII control characters in untrusted input; these ranges are intentional.
  // eslint-disable-next-line no-control-regex
  if (/\x00|[\x01-\x1f]/.test(str)) {
    throw new BadRequestException(`${fieldName} contains invalid characters`);
  }

  // Raw trimmed input checks
  const trimmed = str.trim();

  // Reject empty after trim
  if (trimmed === "") return undefined;

  // Reject absolute paths BEFORE stripping - this catches /etc/passwd
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new BadRequestException(`${fieldName} must be a relative path`);
  }

  // Reject UNC paths (Windows network paths)
  if (trimmed.startsWith("\\\\")) {
    throw new BadRequestException(`${fieldName} must be a relative path`);
  }

  // Split on both separators to check segments for traversal BEFORE normalization
  const rawSegments = trimmed.split(/[/\\]/);
  for (const seg of rawSegments) {
    if (seg === ".." || seg === ".") {
      throw new BadRequestException(`${fieldName} must not contain traversal patterns`);
    }
  }

  // Normalize: separators to forward slash, collapse, trim trailing
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "");

  // Reject empty after normalization
  if (normalized === "") return undefined;

  // Check for Windows drive letters AFTER normalization
  if (/^[A-Za-z]:/.test(normalized)) {
    throw new BadRequestException(`${fieldName} must be a relative path`);
  }

  // Re-check for traversal segments after normalization (shouldn't happen due to early check)
  // Only reject actual traversal patterns, not names containing dots like "file.txt"
  const finalSegments = normalized.split("/");
  for (const seg of finalSegments) {
    if (seg === ".." || seg === ".") {
      throw new BadRequestException(`${fieldName} must not contain traversal patterns`);
    }
  }

  // Max length check
  if (normalized.length > 255) {
    throw new BadRequestException(`${fieldName} exceeds maximum length of 255 characters`);
  }

  return normalized;
}

@Injectable()
export class StreamerService {
  constructor(private readonly repository: StreamsRepository) {}

  private rejectOwnerInput(dto: object): void {
    if (dto && ("owner_id" in dto || "ownerId" in dto)) {
      throw new BadRequestException("Owner cannot be specified by client");
    }
  }

  createCreator(dto: CreateCreatorDto, ownerId?: string): Promise<Creator> {
    this.rejectOwnerInput(dto);
    return this.repository.createCreator(dto, ownerId);
  }

  updateCreator(id: string, dto: PatchCreatorDto, ownerId?: string): Promise<Creator> {
    this.rejectOwnerInput(dto);
    return this.repository.updateCreator(id, dto, ownerId);
  }

  removeCreator(id: string, ownerId?: string): Promise<void> {
    return this.repository.removeCreator(id, ownerId);
  }

  async findAllCreators(ownerId?: string): Promise<Creator[]> {
    return await this.repository.findAllCreators(ownerId);
  }

  async findOneCreator(creatorId: string, ownerId?: string): Promise<Creator> {
    return await this.repository.findOneCreator(creatorId, ownerId);
  }

  async findWatchTargetsByCreator(creatorId: string, ownerId?: string): Promise<WatchTarget[]> {
    return await this.repository.findWatchTargetsByCreator(creatorId, ownerId);
  }

  async findAllWatchTargets(ownerId?: string): Promise<WatchTarget[]> {
    return await this.repository.findAllWatchTargets(ownerId);
  }

  async findOneWatchTarget(id: string, ownerId?: string): Promise<WatchTarget> {
    return await this.repository.findOneWatchTarget(id, ownerId);
  }

  async createWatchTarget(dto: CreateWatchTargetDto, ownerId?: string): Promise<WatchTarget> {
    this.rejectOwnerInput(dto);
    // Validate and normalize recording_subdir if provided
    const normalizedSubdir = validateRecordingSubdirInput(dto.recording_subdir, "recording_subdir");
    const entity = { ...dto, recording_subdir: normalizedSubdir };
    return await this.repository.createWatchTarget(entity, ownerId);
  }

  async removeWatchTarget(id: string, ownerId?: string): Promise<void> {
    return await this.repository.removeWatchTarget(id, ownerId);
  }

  async updateWatchTarget(
    id: string,
    dto: PatchWatchTargetDto,
    ownerId?: string,
  ): Promise<WatchTarget> {
    this.rejectOwnerInput(dto);
    if (
      !dto ||
      typeof dto !== "object" ||
      Array.isArray(dto) ||
      Object.keys(dto).some(
        (key) => !["enabled", "recording_subdir", "quality", "url"].includes(key),
      )
    ) {
      throw new BadRequestException("Unsupported WatchTarget configuration");
    }
    if (dto.enabled !== undefined && typeof dto.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean");
    }
    let subdir: string | undefined;
    if (dto.recording_subdir !== undefined) {
      if (typeof dto.recording_subdir !== "string") {
        throw new BadRequestException("recording_subdir must be a string");
      }
      subdir = validateRecordingSubdirInput(dto.recording_subdir) ?? "";
    }
    if ("quality" in dto && dto.quality !== undefined) {
      if (
        typeof dto.quality !== "string" ||
        !WATCH_TARGET_QUALITIES.some((quality) => quality === dto.quality)
      ) {
        throw new BadRequestException("quality must be a supported Streamlink quality value");
      }
    }
    let url: string | undefined;
    if (dto.url !== undefined) {
      if (typeof dto.url !== "string") {
        throw new BadRequestException("url must be a string");
      }
      if (!isURL(dto.url, WATCH_TARGET_URL_OPTIONS)) {
        throw new BadRequestException(
          "url must be an absolute HTTP or HTTPS URL without credentials",
        );
      }
      url = dto.url;
    }
    return this.repository.updateWatchTarget(
      id,
      {
        recordingSubdir: subdir,
        enabled: dto.enabled,
        quality: dto.quality,
        url: url,
      },
      ownerId,
    );
  }

  async findAllStreamer(ownerId?: string): Promise<StreamerDto[]> {
    return await this.repository.findAllStreamer(ownerId);
  }

  async findOneStreamer(id: string, ownerId?: string): Promise<StreamerDto> {
    return await this.repository.findOneStreamer(id, ownerId);
  }

  async createStreamer(dto: CreateStreamerDto, ownerId?: string): Promise<StreamerDto> {
    this.rejectOwnerInput(dto);
    return await this.repository.createStreamer(dto, ownerId);
  }

  async removeStreamer(id: string, ownerId?: string) {
    return await this.repository.removeStreamer(id, ownerId);
  }
}

@Injectable()
export class SessionService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllSessions(ownerId?: string): Promise<SessionDto[]> {
    return await this.repository.findAllSessions(ownerId);
  }

  async findOneSession(id: string, ownerId?: string): Promise<SessionDto> {
    return await this.repository.findOneSession(id, ownerId);
  }

  async findSessionsByChannel(channel_id: string, ownerId?: string): Promise<SessionDto[]> {
    return await this.repository.findSessionsByChannel(channel_id, ownerId);
  }
}

@Injectable()
export class StreamService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllStreams(ownerId?: string): Promise<Stream[]> {
    return await this.repository.findAllStreams(ownerId);
  }

  async findOneStream(id: string, ownerId?: string): Promise<Stream> {
    return await this.repository.findOneStream(id, ownerId);
  }

  async findActiveStreamByWatchTarget(
    watchTargetId: string,
    ownerId?: string,
  ): Promise<Stream | null> {
    return await this.repository.findActiveStreamByWatchTarget(watchTargetId, ownerId);
  }

  async findStreamsByWatchTarget(
    watchTargetId: string,
    since?: string,
    ownerId?: string,
  ): Promise<Stream[]> {
    return await this.repository.findStreamsByWatchTarget(watchTargetId, since, ownerId);
  }
}

@Injectable()
export class RecordingService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllRecordings(watchTargetId?: string, ownerId?: string): Promise<Recording[]> {
    if (watchTargetId) {
      return await this.repository.findRecordingsByWatchTarget(watchTargetId, ownerId);
    }
    return await this.repository.findAllRecordings(ownerId);
  }

  async findOneRecording(id: string, ownerId?: string): Promise<Recording> {
    return await this.repository.findOneRecording(id, ownerId);
  }
}
