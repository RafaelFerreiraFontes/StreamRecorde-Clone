"use client";
import { useState, useSyncExternalStore } from "react";
import { api, requestLog, type RequestLog } from "@/lib/api";
import { useDashboard } from "@/components/provider";
import { Empty, Json, ResourceStatus, Table } from "@/components/ui";
const empty: RequestLog[] = [];
export default function Diagnostics() {
  const { snapshot } = useDashboard();
  const logs = useSyncExternalStore(
    requestLog.subscribe,
    requestLog.snapshot,
    () => empty,
  );
  const [legacy, setLegacy] = useState<unknown>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function inspect(path: string) {
    setBusy(true);
    setError("");
    setLegacy(undefined);
    try {
      setLegacy(await api(path));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Integration / Request inspection</div>
          <h1>Diagnostics</h1>
          <p>
            Inspect API responses and recent requests. Logs stay in memory for
            this browser session.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Recent API requests</h2>
          <span className="tag">LATEST 80</span>
        </div>
        {logs.length ? (
          <Table
            headings={[
              "Method",
              "Request path",
              "HTTP status",
              "Duration",
              "Timestamp",
              "Error",
            ]}
          >
            {logs.map((log) => (
              <tr key={log.id}>
                <td>
                  <code>{log.method}</code>
                </td>
                <td>
                  <code>{log.path}</code>
                </td>
                <td>
                  <span className={log.error ? "text-error" : ""}>
                    {log.status ?? "Network error"}
                  </span>
                </td>
                <td>{log.duration} ms</td>
                <td>
                  <code>{log.timestamp}</code>
                </td>
                <td>
                  {log.error && (
                    <details>
                      <summary>Inspect error</summary>
                      <pre>{log.error}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No requests yet.</Empty>
        )}
      </section>
      <h2 className="section-title">Domain JSON inspector</h2>
      {(["creators", "watch-targets", "streams", "recordings"] as const).map(
        (key) => (
          <div key={key}>
            <ResourceStatus resource={key} />
            {snapshot[key].data && (
              <Json title={`GET /${key}`} data={snapshot[key].data} />
            )}
          </div>
        ),
      )}
      <section className="panel legacy">
        <h2>Legacy Compatibility</h2>
        <p>
          These contracts exist for MVP compatibility and are not the future
          domain API. Inspection here is read-only and never drives the main
          dashboard.
        </p>
        <div className="toolbar">
          <button disabled={busy} onClick={() => void inspect("/streamer")}>
            Inspect GET /streamer
          </button>
          <button disabled={busy} onClick={() => void inspect("/session")}>
            Inspect GET /session
          </button>
        </div>
        {busy && <p role="status">Loading compatibility response…</p>}
        {error && (
          <div className="error" role="alert">
            <pre>{error}</pre>
          </div>
        )}
        {legacy !== undefined && <Json data={legacy} title="Legacy response" />}
      </section>
    </>
  );
}
