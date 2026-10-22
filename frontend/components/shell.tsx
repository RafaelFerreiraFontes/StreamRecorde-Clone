"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  const {
    snapshot,
    automatic,
    setAutomatic,
    busy,
    refresh,
    authState,
    authBusy,
    session,
    authError,
    login,
    logout,
    retrySession,
    generation,
  } = useDashboard();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!["local", "authenticated"].includes(authState)) {
    return (
      <main className="session-screen">
        <section className="session-panel" aria-labelledby="session-title">
          <h1 id="session-title">StreamRecorder</h1>
          {authState === "initializing" ? (
            <p role="status">Verifying session...</p>
          ) : authState === "backend_unavailable" ? (
            <>
              <p role="alert">{authError}</p>
              <button onClick={() => void retrySession()}>Retry</button>
            </>
          ) : (
            <>
              <h2>Sign in</h2>
              {authError && (
                <p className="error" role="alert">
                  {authError}
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitting(true);
                  const secret = password;
                  setPassword("");
                  void login(username, secret).finally(() => setSubmitting(false));
                }}
              >
                <label>
                  Username
                  <input
                    name="username"
                    autoComplete="username"
                    value={username}
                    required
                    disabled={submitting}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    required
                    disabled={submitting}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button className="primary" disabled={submitting || authBusy}>
                  {submitting ? "Signing in..." : authBusy ? "Signing out..." : "Sign in"}
                </button>
              </form>
              <div className="toolbar">
                <button disabled={submitting || authBusy} onClick={() => void retrySession()}>
                  Verify session
                </button>
                {authState === "authentication_error" && (
                  <button disabled={submitting || authBusy} onClick={() => void logout()}>
                    Retry sign out
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    );
  }
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
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
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
            <span className={`connection ${failures ? "bad" : ""}`}>●</span> {status}
            <small>
              Last successful API response: {last ? new Date(last).toLocaleTimeString() : "—"}
            </small>
          </div>
          <div className="toolbar">
            {authState === "authenticated" && (
              <>
                <span className="tag">{session?.user?.username}</span>
                <button
                  onClick={() => {
                    setPassword("");
                    setUsername("");
                    void logout();
                  }}
                >
                  Sign out
                </button>
              </>
            )}
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
        <main key={generation}>{children}</main>
        <footer>
          Observed state only · Worker detection interval defaults to 60 seconds · No realtime
          connection
        </footer>
      </div>
    </div>
  );
}
