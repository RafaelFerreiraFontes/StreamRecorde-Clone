"use client";
import Link from "next/link";
import { useDashboard } from "@/components/provider";
import { Badge, ResourceStatus, Table, Empty } from "@/components/ui";
export default function Overview() {
  const { snapshot } = useDashboard();
  const targets = snapshot["watch-targets"].data;
  const recording = targets?.filter((x) => x.state === "recording").length;
  const metrics = [
    ["Creators", snapshot.creators.data?.length, "/creators"],
    ["Watch Targets", targets?.length, "/watch-targets"],
    ["Recording targets", recording, "/watch-targets"],
    ["Streams", snapshot.streams.data?.length, "/streams"],
    ["Recordings", snapshot.recordings.data?.length, "/recordings"],
    [
      "Target errors",
      targets?.filter((x) => x.state === "error").length,
      "/watch-targets",
    ],
  ] as const;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Operations / Overview</div>
          <h1>Integration overview</h1>
          <p>
            A clear view of monitoring configuration and persisted runtime
            activity.
          </p>
        </div>
        <Link className="button primary" href="/watch-targets">
          Manage watch targets →
        </Link>
      </div>
      <div className="metrics">
        {metrics.map(([label, count, href]) => (
          <Link className="metric" href={href} key={label}>
            <span>{label}</span>
            <strong>{count ?? "—"}</strong>
            <small>Current API snapshot ↗</small>
          </Link>
        ))}
      </div>
      {(["creators", "watch-targets", "streams", "recordings"] as const).map(
        (r) => (
          <ResourceStatus key={r} resource={r} />
        ),
      )}
      <section className="panel activity">
        <div className="eyebrow">Worker activity</div>
        <h2>
          {!targets || snapshot["watch-targets"].error
            ? "Runtime state unavailable"
            : recording
              ? "Recording activity detected"
              : "No active recording"}
        </h2>
        <p>
          The current MVP has no Worker heartbeat endpoint. Worker status is
          inferred only from persisted runtime state.
        </p>
        <div className="pipeline">
          <span>Frontend</span>
          <b>→</b>
          <span>NestJS API</span>
          <b>→</b>
          <span>Shared JSON</span>
          <b>↔</b>
          <span>Python Worker</span>
        </div>
        <small>
          API polling: 5 seconds. Worker detection: 60 seconds by default, plus
          probe time. Persisted state may be stale.
        </small>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Watch target snapshot</h2>
          <Link href="/watch-targets">View all →</Link>
        </div>
        {targets?.length ? (
          <Table headings={["Channel", "Creator", "Platform", "State"]}>
            {targets.slice(0, 8).map((t) => (
              <tr key={t.id}>
                <td>{t.channel_name}</td>
                <td>{t.creator_id}</td>
                <td>{t.platform}</td>
                <td>
                  <Badge state={t.state} />
                </td>
              </tr>
            ))}
          </Table>
        ) : targets ? (
          <Empty>
            No watch targets yet. Create a target to begin validating the
            integration.
          </Empty>
        ) : null}
      </section>
    </>
  );
}
