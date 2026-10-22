"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError, requestLog } from "@/lib/api";
import type { AuthSession, AuthState, Creator, WatchTarget, Stream, Recording } from "@/lib/types";
type Data = {
  creators: Creator[];
  "watch-targets": WatchTarget[];
  streams: Stream[];
  recordings: Recording[];
};
export type Resource = keyof Data;
const resources: Resource[] = ["creators", "watch-targets", "streams", "recordings"];
type Snapshot = {
  [K in Resource]: { data?: Data[K]; error?: string; updated?: string };
};
function useDashboardData() {
  const [authState, setAuthState] = useState<AuthState>("initializing");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const authOperation = useRef(false);
  const [generation, setGeneration] = useState(0);
  const epoch = useRef(0);
  const controller = useRef(new AbortController());
  const currentSession = useRef<AuthSession | null>(null);
  const allowed = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    creators: {},
    "watch-targets": {},
    streams: {},
    recordings: {},
  });
  const [automatic, setAutomatic] = useState(true);
  const [busy, setBusy] = useState(false);
  const running = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const isCurrentGeneration = useCallback((value: number) => value === epoch.current, []);
  const invalidate = useCallback(() => {
    allowed.current = false;
    controller.current.abort();
    controller.current = new AbortController();
    epoch.current += 1;
    setGeneration(epoch.current);
    running.current = null;
    setSnapshot({ creators: {}, "watch-targets": {}, streams: {}, recordings: {} });
    setBusy(false);
    currentSession.current = null;
    requestLog.clear();
    return epoch.current;
  }, []);
  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const active = epoch.current;
      const signal = controller.current.signal;
      try {
        const data = await api<T>(path, {
          ...init,
          signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
        });
        if (active !== epoch.current)
          throw new DOMException("Stale identity request", "AbortError");
        return data;
      } catch (error) {
        if (active === epoch.current && error instanceof ApiError && error.status === 401) {
          invalidate();
          currentSession.current = null;
          setSession(null);
          setAuthError("Your session expired. Sign in again.");
          setAuthState("unauthenticated");
        }
        throw error;
      }
    },
    [invalidate],
  );
  const applySession = useCallback(
    (next: AuthSession) => {
      if (
        !next ||
        !["local", "authenticated"].includes(next.identityMode) ||
        !["json", "relational"].includes(next.persistence) ||
        (next.user !== null && (!next.user?.id || !next.user?.username)) ||
        (next.identityMode === "local" && next.persistence === "relational" && !next.user)
      )
        throw new Error("Invalid session response");
      const previous = currentSession.current;
      if (
        previous &&
        (previous.identityMode !== next.identityMode || previous.user?.id !== next.user?.id)
      )
        invalidate();
      currentSession.current = next;
      setSession(next);
      setAuthError("");
      allowed.current = next.identityMode === "local" || next.user !== null;
      setAuthState(
        next.identityMode === "local" ? "local" : next.user ? "authenticated" : "unauthenticated",
      );
    },
    [invalidate],
  );
  const sessionFailure = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        invalidate();
        currentSession.current = null;
        setSession(null);
        setAuthState("unauthenticated");
        setAuthError("Your session expired. Sign in again.");
        return;
      }
      invalidate();
      setSession(null);
      currentSession.current = null;
      const unavailable = error instanceof ApiError && [null, 502, 503].includes(error.status);
      setAuthState(unavailable ? "backend_unavailable" : "authentication_error");
      setAuthError(
        unavailable
          ? "The backend is unavailable. Retry to verify your session."
          : "Unable to verify your session. Please retry.",
      );
    },
    [invalidate],
  );
  const retrySession = useCallback(async () => {
    if (authOperation.current) return;
    const active = epoch.current;
    try {
      const next = await api<AuthSession>("/auth/session", { signal: controller.current.signal });
      if (active === epoch.current && !authOperation.current) applySession(next);
    } catch (error) {
      if (active === epoch.current && !authOperation.current) sessionFailure(error);
    }
  }, [applySession, sessionFailure]);
  const login = useCallback(
    async (username: string, password: string) => {
      if (authOperation.current) return;
      authOperation.current = true;
      setAuthBusy(true);
      const active = epoch.current;
      try {
        const next = await api<AuthSession>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
          signal: controller.current.signal,
        });
        if (active !== epoch.current) return;
        invalidate();
        applySession(next);
      } catch (error) {
        if (active !== epoch.current) return;
        setAuthError(
          error instanceof ApiError && error.status === 401
            ? "Invalid username or password."
            : "Sign in failed. Check the backend and retry.",
        );
        setAuthState("authentication_error");
      } finally {
        authOperation.current = false;
        setAuthBusy(false);
      }
    },
    [applySession, invalidate],
  );
  const logout = useCallback(async () => {
    if (authOperation.current) return;
    authOperation.current = true;
    setAuthBusy(true);
    const active = invalidate();
    setSession(null);
    currentSession.current = null;
    setAuthState("unauthenticated");
    setAuthError("");
    try {
      await api("/auth/logout", { method: "POST", signal: controller.current.signal });
    } catch {
      if (active !== epoch.current) return;
      setAuthState("authentication_error");
      setAuthError("Sign out could not be confirmed. Retry sign out or verify your session.");
    } finally {
      authOperation.current = false;
      setAuthBusy(false);
    }
  }, [invalidate]);
  const refresh = useCallback((): Promise<void> => {
    if (!allowed.current) return Promise.resolve();
    const active = epoch.current;
    if (running.current?.generation === active) return running.current.promise;
    setBusy(true);
    const promise = Promise.all(
      resources.map(async (key) => {
        try {
          const data = await request<Data[typeof key]>(`/${key}`);
          if (active !== epoch.current) return;
          if (!Array.isArray(data)) throw new Error("Invalid API response: expected an array");
          setSnapshot((old) => ({
            ...old,
            [key]: { data, updated: new Date().toISOString() },
          }));
        } catch (error) {
          if (active !== epoch.current) return;
          setSnapshot((old) => ({
            ...old,
            [key]: { ...old[key], error: String(error) },
          }));
        }
      }),
    )
      .then(() => {})
      .finally(() => {
        if (active !== epoch.current) return;
        running.current = null;
        setBusy(false);
      });
    running.current = { generation: active, promise };
    return promise;
  }, [request]);
  // A mutation may overlap an older GET; wait for it, then force a fresh cycle.
  const afterMutation = useCallback(async () => {
    const active = epoch.current;
    await running.current?.promise;
    if (active !== epoch.current) return;
    await refresh();
  }, [refresh]);
  useEffect(() => {
    void retrySession();
  }, [retrySession]);
  useEffect(() => {
    if (authState === "local" || authState === "authenticated") void refresh();
  }, [authState, generation, refresh]);
  useEffect(() => {
    if (!automatic || !["local", "authenticated"].includes(authState)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void retrySession().then(refresh);
    }, 5000);
    return () => clearInterval(timer);
  }, [automatic, authState, refresh, retrySession]);
  return {
    snapshot,
    automatic,
    setAutomatic,
    busy,
    refresh,
    afterMutation,
    authState,
    authBusy,
    session,
    authError,
    login,
    logout,
    retrySession,
    generation,
    request,
    isCurrentGeneration,
  };
}
const Context = createContext<ReturnType<typeof useDashboardData> | null>(null);
export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const value = useDashboardData();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDashboard() {
  const value = useContext(Context);
  if (!value) throw new Error("Dashboard provider missing");
  return value;
}
