// Worker timestamps have no timezone. Preserve their wall-clock representation.
export function timestamp(value?: string) {
  return value ? value.replace("T", " ") : "—";
}
export function duration(start: string, end?: string) {
  if (!end) return "—";
  const seconds = Math.floor((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
}
