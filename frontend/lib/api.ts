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
let logGeneration = 0;
export class ApiError extends Error {
  constructor(
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
const listeners = new Set<() => void>();
export const requestLog = {
  clear() {
    logGeneration += 1;
    logs = [];
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  snapshot: () => logs,
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const generation = logGeneration;
  const sensitive = path.split("?")[0] === "/auth/login";
  const start = performance.now();
  let status: number | null = null;
  let failure: string | undefined;
  try {
    const response = await fetch(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
    status = response.status;
    const raw = await response.text();
    if (!response.ok) {
      let message = response.statusText || "Request failed";
      if (!sensitive) {
        try {
          const body: unknown = JSON.parse(raw);
          if (
            body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
          )
            message = body.message;
        } catch {}
      }
      throw new ApiError(status, `HTTP ${status}: ${message}`);
    }
    return (raw ? JSON.parse(raw) : undefined) as T;
  } catch (error) {
    failure = error instanceof ApiError ? error.message : "Failed to fetch API response";
    throw error instanceof ApiError ? error : new ApiError(null, failure);
  } finally {
    if (!sensitive && generation === logGeneration && !init.signal?.aborted) {
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
}
