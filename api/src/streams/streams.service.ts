import { Injectable, BadRequestException } from "@nestjs/common";
import { StreamsRepository } from "./streams.repository";
import { CreateStreamerDto, StreamerDto } from "./dto/streamer.dto";
import { CreateWatchTargetDto, PatchWatchTargetDto } from "./dto/watch-target.dto";
import { SessionDto } from "./dto/session.dto";
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
function validateRecordingSubdirInput(value: unknown, fieldName = "recording_subdir"): string | undefined {
  if (value === undefined || value === null) return undefined;

  // Reject non-string values explicitly - do not coerce
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string`);
  }

  const str = value;

  // Check for null/control characters before any processing
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
  const rawSegments = trimmed.split(/[\/\\]/);
  for (const seg of rawSegments) {
    if (seg === ".." || seg === ".") {
      throw new BadRequestException(`${fieldName} must not contain traversal patterns`);
    }
  }

  // Normalize: separators to forward slash, collapse, trim trailing
  let normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/g, "");

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

  async findAllCreators(): Promise<Creator[]> {
    return await this.repository.findAllCreators();
  }

  async findOneCreator(creatorId: string): Promise<Creator> {
    return await this.repository.findOneCreator(creatorId);
  }

  async findWatchTargetsByCreator(creatorId: string): Promise<WatchTarget[]> {
    return await this.repository.findWatchTargetsByCreator(creatorId);
  }

  async findAllWatchTargets(): Promise<WatchTarget[]> {
    return await this.repository.findAllWatchTargets();
  }

  async findOneWatchTarget(id: string): Promise<WatchTarget> {
    return await this.repository.findOneWatchTarget(id);
  }

  async createWatchTarget(dto: CreateWatchTargetDto): Promise<WatchTarget> {
    // Validate and normalize recording_subdir if provided
    const normalizedSubdir = validateRecordingSubdirInput(dto.recording_subdir, "recording_subdir");
    const entity = { ...dto, recording_subdir: normalizedSubdir };
    return await this.repository.createWatchTarget(entity);
  }

  async removeWatchTarget(id: string): Promise<void> {
    return await this.repository.removeWatchTarget(id);
  }

  async updateWatchTarget(id: string, dto: PatchWatchTargetDto): Promise<WatchTarget> {
    if (!dto || typeof dto !== "object" || Array.isArray(dto) ||
        Object.keys(dto).some(key => !["enabled", "recording_subdir"].includes(key))) {
      throw new BadRequestException("Unsupported WatchTarget configuration");
    }
    if ("enabled" in dto && typeof dto.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean");
    }
    let subdir: string | undefined;
    if ("recording_subdir" in dto) {
      if (typeof dto.recording_subdir !== "string") {
        throw new BadRequestException("recording_subdir must be a string");
      }
      subdir = validateRecordingSubdirInput(dto.recording_subdir) ?? "";
    }
    return this.repository.updateWatchTarget(id, subdir, dto.enabled);
  }

  async findAllStreamer(): Promise<StreamerDto[]> {
    return await this.repository.findAllStreamer();
  }

  async findOneStreamer(id: string): Promise<StreamerDto> {
    return await this.repository.findOneStreamer(id);
  }

  async createStreamer(dto: CreateStreamerDto): Promise<StreamerDto> {
    return await this.repository.createStreamer(dto);
  }

  async removeStreamer(id: string) {
    return await this.repository.removeStreamer(id);
  }
}

@Injectable()
export class SessionService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllSessions(): Promise<SessionDto[]> {
    return await this.repository.findAllSessions();
  }

  async findOneSession(id: string): Promise<SessionDto> {
    return await this.repository.findOneSession(id);
  }

  async findSessionsByChannel(channel_id: string): Promise<SessionDto[]> {
    return await this.repository.findSessionsByChannel(channel_id);
  }
}

@Injectable()
export class StreamService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllStreams(): Promise<Stream[]> {
    return await this.repository.findAllStreams();
  }

  async findOneStream(id: string): Promise<Stream> {
    return await this.repository.findOneStream(id);
  }

  async findActiveStreamByWatchTarget(
    watchTargetId: string,
  ): Promise<Stream | null> {
    return await this.repository.findActiveStreamByWatchTarget(watchTargetId);
  }

  async findStreamsByWatchTarget(
    watchTargetId: string,
    since?: string,
  ): Promise<Stream[]> {
    return await this.repository.findStreamsByWatchTarget(watchTargetId, since);
  }
}

@Injectable()
export class RecordingService {
  constructor(private readonly repository: StreamsRepository) {}

  async findAllRecordings(watchTargetId?: string): Promise<Recording[]> {
    if (watchTargetId) {
      return await this.repository.findRecordingsByWatchTarget(watchTargetId);
    }
    return await this.repository.findAllRecordings();
  }

  async findOneRecording(id: string): Promise<Recording> {
    return await this.repository.findOneRecording(id);
  }
}
