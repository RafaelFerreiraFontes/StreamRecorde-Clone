"use client";
import { useState } from "react";
import { useDashboard } from "@/components/provider";
import { api } from "@/lib/api";
import {
  qualities,
  type CreateWatchTarget,
  type WatchTarget,
} from "@/lib/types";
import { Badge, Empty, Json, ResourceStatus, Table } from "@/components/ui";
export default function WatchTargets() {
  const { snapshot, afterMutation } = useDashboard();
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const targets = snapshot["watch-targets"].data;
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = Object.fromEntries(
      ["creator_id", "channel_name", "platform", "url", "quality"].map((k) => [
        k,
        String(values.get(k) || "").trim(),
      ]),
    ) as CreateWatchTarget;
    setError("");
    setMessage("");
    if (!payload.creator_id || !payload.channel_name) {
      setError("Creator and channel name must contain text.");
      return;
    }
    try {
      const url = new URL(payload.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      setError("Enter a valid HTTP or HTTPS channel URL without credentials.");
      return;
    }
    setPending(true);
    try {
      await api<WatchTarget>("/watch-targets", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage("Watch target created.");
      form.reset();
      setShowForm(false);
      await afterMutation();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function remove(target: WatchTarget) {
    if (
      !window.confirm(
        `Delete watch target "${target.channel_name}" (${target.id})? Only this monitoring configuration will be removed. This does not guarantee stopping an active recording.`,
      )
    )
      return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await api(`/watch-targets/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      setMessage(`Deleted ${target.channel_name}.`);
      await afterMutation();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Operations / Configuration</div>
          <h1>Watch Targets</h1>
          <p>
            Persistent monitoring configuration. Each target belongs to one
            Creator.
          </p>
        </div>
        <button className="primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Close form" : "+ Create WatchTarget"}
        </button>
      </div>
      {message && (
        <div className="success" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <pre>{error}</pre>
        </div>
      )}
      {showForm && (
        <section className="panel form-panel">
          <h2>Create WatchTarget</h2>
          <p>
            Choose an existing Creator or type a new display name. The current
            API uses this value as <code>creator_id</code>; there is no separate
            Creator creation endpoint.
          </p>
          <form onSubmit={create}>
            <div className="form-grid">
              <label>
                Creator
                <input
                  name="creator_id"
                  list="creators"
                  placeholder="Select or enter a display name"
                  required
                  maxLength={200}
                />
                <datalist id="creators">
                  {snapshot.creators.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </datalist>
              </label>
              <label>
                Channel Name
                <input
                  name="channel_name"
                  required
                  maxLength={200}
                  placeholder="Channel name"
                />
              </label>
              <label>
                Platform
                <select name="platform" defaultValue="twitch">
                  <option value="twitch">Twitch</option>
                  <option value="youtube">YouTube</option>
                  <option value="kick">Kick</option>
                </select>
              </label>
              <label>
                Quality
                <select name="quality" defaultValue="best">
                  {qualities.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                URL
                <input
                  name="url"
                  type="url"
                  placeholder="https://www.twitch.tv/channel"
                  required
                  maxLength={2048}
                />
              </label>
            </div>
            <button className="primary" disabled={pending}>
              {pending ? "Saving…" : "Create target"}
            </button>
          </form>
        </section>
      )}
      <ResourceStatus resource="watch-targets" />
      <ResourceStatus resource="creators" />
      <section className="panel">
        <div className="section-heading">
          <h2>Monitoring configuration</h2>
          <span className="tag">{targets?.length ?? "—"} TARGETS</span>
        </div>
        {targets?.length ? (
          <Table
            headings={[
              "Channel / ID",
              "Creator",
              "Platform",
              "Quality",
              "State",
              "URL",
              "Actions",
            ]}
          >
            {targets.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.channel_name}</strong>
                  <code className="subtext">{t.id}</code>
                </td>
                <td>
                  {snapshot.creators.data?.find((c) => c.id === t.creator_id)
                    ?.display_name || t.creator_id}
                </td>
                <td>{t.platform}</td>
                <td>
                  <code>{t.quality}</code>
                </td>
                <td>
                  <Badge state={t.state} />
                </td>
                <td>
                  <code className="path">{t.url}</code>
                </td>
                <td>
                  <button
                    className="danger"
                    disabled={pending}
                    onClick={() => void remove(t)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        ) : targets ? (
          <Empty>
            No watch targets. Create your first monitoring configuration above.
          </Empty>
        ) : null}
      </section>
      <p className="note">
        The enabled field is informational and is not a Worker execution gate.
        Monitoring cannot currently be paused through this API.
      </p>
      {targets && <Json data={targets} />}
    </>
  );
}
