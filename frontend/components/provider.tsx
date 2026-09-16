"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import type { Creator, WatchTarget, Stream, Recording } from "@/lib/types";
type Data = {
  creators: Creator[];
  "watch-targets": WatchTarget[];
  streams: Stream[];
  recordings: Recording[];
};
export type Resource = keyof Data;
const resources: Resource[] = [
  "creators",
  "watch-targets",
  "streams",
  "recordings",
];
type Snapshot = {
  [K in Resource]: { data?: Data[K]; error?: string; updated?: string };
};
function useDashboardData() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    creators: {},
    "watch-targets": {},
    streams: {},
    recordings: {},
  });
  const [automatic, setAutomatic] = useState(true);
  const [busy, setBusy] = useState(false);
  const running = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    setBusy(true);
    running.current = Promise.all(
      resources.map(async (key) => {
        try {
          const data = await api<Data[typeof key]>(`/${key}`);
          if (!Array.isArray(data))
            throw new Error("Invalid API response: expected an array");
          setSnapshot((old) => ({
            ...old,
            [key]: { data, updated: new Date().toISOString() },
          }));
        } catch (error) {
          setSnapshot((old) => ({
            ...old,
            [key]: { ...old[key], error: String(error) },
          }));
        }
      }),
    )
      .then(() => {})
      .finally(() => {
        running.current = null;
        setBusy(false);
      });
    return running.current;
  }, []);
  // A mutation may overlap an older GET; wait for it, then force a fresh cycle.
  const afterMutation = useCallback(async () => {
    await running.current;
    await refresh();
  }, [refresh]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [automatic, refresh]);
  return { snapshot, automatic, setAutomatic, busy, refresh, afterMutation };
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
