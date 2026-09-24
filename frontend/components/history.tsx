"use client";
import { RecordingBrowser } from "./recording-browser";
import { useEffect, useState } from "react";
import { useDashboard } from "./provider";
import { Badge, Empty, Json, ResourceStatus, Table } from "./ui";
import { api } from "@/lib/api";
import { timestamp, duration } from "@/lib/format";
import { states, type Recording } from "@/lib/types";
export function History({ kind }: { kind: "streams" | "recordings" }) {
  const { snapshot } = useDashboard();
  const [locationId, setLocationId] = useState<string>();
  const [target, setTarget] = useState("");
  const [state, setState] = useState("");
  const [filtered, setFiltered] = useState<{
    target: string;
    data: Recording[];
  }>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const recordings = kind === "recordings";
  useEffect(() => {
    if (!recordings || !target) return;
    let active = true;
    setError("");
    setFiltered(undefined);
    api<Recording[]>(`/recordings?watchTargetId=${encodeURIComponent(target)}`)
      .then((data) => {
        if (active) {
          if (!Array.isArray(data)) throw new Error("Invalid API response: expected an array");
          setFiltered({ target, data });
        }
      })
      .catch((e) => {
        if (active) {
          setFiltered(undefined);
          setError(String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [recordings, target, snapshot.recordings.updated, retry]);
  const data = recordings
    ? target
      ? filtered?.target === target
        ? filtered.data
        : undefined
      : snapshot.recordings.data
    : snapshot.streams.data;
  const rows = data?.filter(
    (row) =>
      (!target || row.watch_target_id === target) &&
      (!state || row.state === state),
  );
  const targetOptions = new Map(
    (snapshot["watch-targets"].data || []).map((t) => [t.id, t.channel_name]),
  );
  for (const row of snapshot[kind].data || [])
    if (!targetOptions.has(row.watch_target_id))
      targetOptions.set(
        row.watch_target_id,
        `${row.watch_target_id} (removed target)`,
      );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            Domain / {recordings ? "Capture attempts" : "Detected broadcasts"}
          </div>
          <h1>{recordings ? "Recordings" : "Streams"}</h1>
          <p>
            {recordings
              ? "A Recording is one capture attempt. A broadcast can have multiple attempts."
              : "A Stream represents one actual detected broadcast, distinct from its monitoring configuration."}
          </p>
        </div>
      </div>
      <div className="filters">
        <label>
          WatchTarget
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">All watch targets</option>
            {Array.from(targetOptions).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {!recordings && (
          <label>
            State
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ResourceStatus resource={kind} />
      <ResourceStatus resource="watch-targets" />
      {error && target && (
        <div className="error" role="alert">
          <pre>{error}</pre>
          <button onClick={() => setRetry((n) => n + 1)}>
            Retry filtered request
          </button>
        </div>
      )}
      {recordings && target && !data && !error && (
        <Empty>Loading filtered recordings…</Empty>
      )}
      <section className="panel">
        {rows?.length ? (
          <Table
            headings={[
              recordings ? "Recording / Session ID" : "Stream ID",
              "WatchTarget",
              ...(recordings ? ["Stream ID"] : []),
              "State",
              "Started at",
              "Finished at",
              "Duration",
              ...(recordings ? ["Output file (local path)"] : []),
            ]}
          >
            {rows.map((row) => (
              <tr key={"session_id" in row ? row.session_id : row.id}>
                <td>
                  <code>{"session_id" in row ? row.session_id : row.id}</code>
                </td>
                <td>
                  {targetOptions.get(row.watch_target_id) ||
                    row.watch_target_id}
                  <code className="subtext">{row.watch_target_id}</code>
                </td>
                {recordings && (
                  <td>
                    <code>
                      {(row as Recording).stream_id || "Not persisted"}
                    </code>
                  </td>
                )}
                <td>
                  <Badge state={row.state} />
                </td>
                <td>
                  <code>{timestamp(row.started_at)}</code>
                </td>
                <td>
                  <code>{timestamp(row.finished_at)}</code>
                </td>
                <td className="nowrap">
                  {duration(row.started_at, row.finished_at)}
                </td>
                {recordings && (
                  <td>
                    <code className="path">
                      {(row as Recording).output_file || "—"}
                    </code>
                    <button type="button" className="secondary small"
                      onClick={() => setLocationId((row as Recording).session_id)}>
                      Browse location
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        ) : rows ? (
          <Empty>
            No {kind} match this view. History appears after the Worker persists
            activity.
          </Empty>
        ) : null}
      </section>
      <p className="note">
        Timestamps are shown as persisted. The current Worker omits timezone
        offsets. Duration is calculated only when both timestamps are available.
        {recordings &&
          " Stream IDs may not be persisted. Output paths are local Worker filesystem information only."}
      </p>
      {locationId && <RecordingBrowser recordingId={locationId} onClose={() => setLocationId(undefined)} />}
      {data && <Json data={data} />}
    </>
  );
}
