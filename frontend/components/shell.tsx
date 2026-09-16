"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "./provider";
const navigation = [
  ["/", "Overview", "01"],
  ["/watch-targets", "Watch Targets", "02"],
  ["/streams", "Streams", "03"],
  ["/recordings", "Recordings", "04"],
  ["/creators", "Creators", "05"],
  ["/diagnostics", "Diagnostics", "06"],
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { snapshot, automatic, setAutomatic, busy, refresh } = useDashboard();
  const items = Object.values(snapshot);
  const failures = items.filter((x) => x.error).length;
  const status = failures
    ? `${failures}/4 API requests failing`
    : items.every((x) => x.data)
      ? "API requests succeeding"
      : "Connecting to API";
  const last = items
    .map((x) => x.updated || "")
    .sort()
    .at(-1);
  return (
    <div className="app-shell">
      <aside>
        <Link href="/" className="brand">
          <span className="brand-mark">◉</span> StreamRecorder
        </Link>
        <div className="eyebrow">Integration workspace</div>
        <nav aria-label="Main navigation">
          {navigation.map(([href, title, number]) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
            >
              <span>{number}</span>
              {title}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tag">TECHNICAL PREVIEW</span>
          <p>
            API + Worker integration
            <br />
            Local MVP / domain console
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div>
            <span className={`connection ${failures ? "bad" : ""}`}>●</span>{" "}
            {status}
            <small>
              Last successful API response:{" "}
              {last ? new Date(last).toLocaleTimeString() : "—"}
            </small>
          </div>
          <div className="toolbar">
            <label className="check">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => setAutomatic(e.target.checked)}
              />{" "}
              Auto refresh · 5s
            </label>
            <button disabled={busy} onClick={() => void refresh()}>
              {busy ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
        </header>
        <main>{children}</main>
        <footer>
          Observed state only · Worker detection interval defaults to 60 seconds
          · No realtime connection
        </footer>
      </div>
    </div>
  );
}
