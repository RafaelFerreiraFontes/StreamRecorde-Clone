/**
 * Minimal domain contract for Wave 02.1.
 *
 * This file intentionally does not implement a database layer or migrate the
 * current JSON persistence model. It documents the smallest verified boundary
 * that matches the current implementation:
 *
 * - watchlist.json entries represent the current WatchTarget configuration
 * - channels_status.json tracks the active runtime state of a live stream
 * - sessions.json stores activity for a concrete Recording lifecycle
 *
 * The goal is to give Tasks 02-05 a stable vocabulary without introducing
 * speculative abstractions or a future infrastructure model.
 */

export type RecordingState =
  | "idle"
  | "offline"
  | "recording"
  | "finished"
  | "error";

export type StreamPlatform = "youtube" | "twitch" | "kick";

export interface Creator {
  id: string;
  display_name: string;
}

export interface WatchTarget {
  id: string;
  creator_id: string;
  channel_name: string;
  platform: StreamPlatform;
  url: string;
  quality: string;
  enabled: boolean;
  state: RecordingState;
}

export interface Stream {
  id: string;
  watch_target_id: string;
  channel_id: string;
  channel_name: string;
  platform: StreamPlatform;
  url: string;
  state: RecordingState;
  started_at?: string;
  finished_at?: string;
}

export interface Recording {
  session_id: string;
  watch_target_id: string;
  stream_id?: string;
  channel_id: string;
  started_at: string;
  finished_at?: string;
  output_file?: string;
  state: RecordingState;
  platform: StreamPlatform;
}

/**
 * Backward-compatibility map for the current legacy API and worker contract.
 *
 * StreamerDto currently bundles identity, runtime state, and monitoring config.
 * This document intentionally keeps the naming explicit while preserving the
 * legacy JSON and endpoints used by the current worker.
 */
export interface LegacyStreamerCompatibility {
  creator: Creator;
  watch_target: WatchTarget;
  stream: Stream;
  recording: Recording;
}
