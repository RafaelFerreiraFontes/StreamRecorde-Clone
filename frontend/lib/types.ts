export type RecordingState =
  "idle" | "offline" | "recording" | "finished" | "error";
export interface Creator {
  id: string;
  display_name: string;
}
export interface WatchTarget {
  id: string;
  creator_id: string;
  channel_name: string;
  platform: "youtube" | "twitch" | "kick";
  url: string;
  quality: string;
  enabled: boolean;
  state: RecordingState;
  /** Optional relative subdirectory for recordings. */
  recording_subdir?: string;
}
export interface Stream {
  id: string;
  watch_target_id: string;
  state: RecordingState;
  started_at: string;
  finished_at?: string;
}
export interface Recording {
  session_id: string;
  watch_target_id: string;
  stream_id?: string;
  started_at: string;
  finished_at?: string;
  output_file?: string;
  state: RecordingState;
}
export type CreateWatchTarget = Pick<
  WatchTarget,
  "creator_id" | "channel_name" | "platform" | "url" | "quality"
>;
export const states: RecordingState[] = [
  "idle",
  "offline",
  "recording",
  "finished",
  "error",
];
export const qualities = [
  "best",
  "worst",
  "source",
  "chunked",
  "1080p60",
  "720p60",
  "1080p",
  "720p",
  "480p",
  "360p",
];
