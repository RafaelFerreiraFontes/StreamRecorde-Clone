export interface RequestLog {
  id: number;
  path: string;
  method: string;
  status: number | null;
  duration: number;
  timestamp: string;
  error?: string;
}
let logs: RequestLog[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
export const requestLog = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  snapshot: () => logs,
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const start = performance.now();
  let status: number | null = null;
  let failure: string | undefined;
  try {
    const response = await fetch(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(12000),
    });
    status = response.status;
    const raw = await response.text();
    if (!response.ok)
      throw new Error(`HTTP ${status}: ${raw || response.statusText}`);
    return (raw ? JSON.parse(raw) : undefined) as T;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw new Error(failure);
  } finally {
    logs = [
      {
        id: ++sequence,
        path,
        method: init.method || "GET",
        status,
        duration: Math.round(performance.now() - start),
        timestamp: new Date().toISOString(),
        error: failure,
      },
      ...logs,
    ].slice(0, 80);
    listeners.forEach((fn) => fn());
  }
}
