"use client";
import { RecordingBrowser } from "@/components/recording-browser";
import { useState } from "react";
import { useDashboard } from "@/components/provider";
import { api } from "@/lib/api";
import {
  qualities,
  type WatchTarget,
} from "@/lib/types";
import { Badge, Empty, Json, ResourceStatus, Table } from "@/components/ui";

type EditingTarget = { id: string; recording_subdir?: string } | null;

export function WatchTargetEnabledSwitch({
  target,
  pending,
  afterMutation,
  onError,
}: {
  target: WatchTarget;
  pending: boolean;
  afterMutation: () => Promise<void>;
  onError: (error: string) => void;
}) {
  const [saving, setSaving] = useState<boolean>();
  const enabled = saving ?? target.enabled;

  async function toggleEnabled() {
    const nextEnabled = !target.enabled;
    setSaving(nextEnabled);
    onError("");
    try {
      await api<WatchTarget>(`/watch-targets/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      await afterMutation();
    } catch (error) {
      onError(String(error));
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-label={`Enabled for ${target.channel_name} (${target.id})`}
      aria-checked={enabled}
      aria-busy={saving !== undefined}
      disabled={pending || saving !== undefined}
      className="secondary small"
      onClick={() => void toggleEnabled()}
    >
      {saving !== undefined ? "Saving..." : target.enabled ? "Enabled" : "Disabled"}
    </button>
  );
}

export default function WatchTargets() {
  const { snapshot, afterMutation } = useDashboard();
  const [picker, setPicker] = useState<"create" | "edit" | null>(null);
  const [createFolder, setCreateFolder] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  const [editValue, setEditValue] = useState("");
  const targets = snapshot["watch-targets"].data;

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload: Record<string, string> = {};
    for (const k of ["creator_id", "channel_name", "platform", "url", "quality"]) {
      const v = String(values.get(k) || "").trim();
      if (!v) {
        setError(`${k} is required.`);
        return;
      }
      payload[k] = v;
    }
    // Include recording_subdir if provided
    const subdir = String(values.get("recording_subdir") || "").trim();
    if (subdir) {
      payload.recording_subdir = subdir;
    }
    setError("");
    setMessage("");

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
      setCreateFolder("");
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

  function startEdit(target: WatchTarget) {
    setEditingTarget({ id: target.id, recording_subdir: target.recording_subdir });
    setEditValue(target.recording_subdir ?? "");
  }

  function cancelEdit() {
    setEditingTarget(null);
    setEditValue("");
  }

  async function saveEdit() {
    if (!editingTarget) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      // Empty string clears the override; undefined would be no-op
      await api(`/watch-targets/${encodeURIComponent(editingTarget.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ recording_subdir: editValue }),
      });
      setMessage("Recording folder updated.");
      setEditingTarget(null);
      setEditValue("");
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
              <label className="full">
                Recording Folder
                <div className="folder-input"><input
                  value={createFolder}
                  onChange={event => setCreateFolder(event.target.value)}
                  name="recording_subdir"
                  placeholder="Relative path (e.g. twitch/favorites)"
                  maxLength={255}
                />
                <button type="button" className="secondary" aria-label="Browse recording folders" onClick={() => setPicker("create")} disabled={pending}>Browse</button></div>
                <span className="hint">
                  Optional. Path relative to the server's recordings root. Leave
                  empty to use the default (channel name).
                </span>
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
              "Recording Folder",
              "Enabled",
              "State",
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
                  {editingTarget?.id === t.id ? (
                    <div className="edit-subdir">
                      <div className="folder-input"><input
                        aria-label="Recording folder"
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="Relative path"
                        maxLength={255}
                        disabled={pending}
                      />
                      <button type="button" className="secondary small" aria-label="Browse recording folders" onClick={() => setPicker("edit")} disabled={pending}>Browse</button></div>
                      <button
                        className="primary small"
                        onClick={saveEdit}
                        disabled={pending}
                      >
                        Save
                      </button>
                      <button
                        className="secondary small"
                        onClick={cancelEdit}
                        disabled={pending}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={t.recording_subdir ? "path" : "muted"}>
                        {t.recording_subdir || "—"}
                      </span>
                      <button
                        className="secondary small inline"
                        onClick={() => startEdit(t)}
                        disabled={pending}
                        title="Edit recording folder"
                        aria-label="Edit recording folder"
                      >
                        Edit
                      </button>
                    </>
                  )}
                </td>
                <td>
                  <WatchTargetEnabledSwitch
                    target={t}
                    pending={pending}
                    afterMutation={afterMutation}
                    onError={setError}
                  />
                </td>
                <td>
                  <Badge state={t.state} />
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
        Enabled is saved per target. The existing Worker skips new probes for disabled
        targets; active recordings continue. Changes take effect when configuration
        is re-read. This wave does not change Worker execution behavior.
      </p>
      {picker && <RecordingBrowser
        initialPath={picker === "edit" ? editValue : undefined}
        onClose={() => setPicker(null)}
        onSelect={picker === "create" ? setCreateFolder : setEditValue}
      />}
      {targets && <Json data={targets} />}
    </>
  );
}
