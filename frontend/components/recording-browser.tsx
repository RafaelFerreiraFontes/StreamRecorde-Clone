"use client";
import { useEffect, useRef, useState } from "react";
import { useDashboard } from "./provider";
import type { RecordingDirectory as Directory, RecordingLocation as Location } from "@/lib/types";

/** Shared server-storage browser. Native dialog supplies focus trapping and Escape. */
export function RecordingBrowser({
  recordingId,
  initialPath,
  onSelect,
  onClose,
}: {
  recordingId?: string;
  initialPath?: string;
  onSelect?: (relative: string) => void;
  onClose: () => void;
}) {
  const { request: api, authState, generation, isCurrentGeneration } = useDashboard();
  const dialog = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState<string | null>(initialPath ?? (recordingId ? null : ""));
  const [directory, setDirectory] = useState<Directory>();
  const [location, setLocation] = useState<Location>();
  const metadataOnly = authState === "authenticated" || (!!location?.status && !location.directory);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (authState !== "local" && authState !== "authenticated") return;
    let active = true;
    const current = () => active && isCurrentGeneration(generation);
    Promise.resolve().then(() => {
      if (!current()) return;
      setLoading(true);
      setError("");
      setDirectory(undefined);
      setLocation(undefined);
      if (authState === "authenticated" && !recordingId) {
        setLoading(false);
        return;
      }
      const request =
        (path === null || authState === "authenticated") && recordingId
          ? api<Location>(`/recordings/${encodeURIComponent(recordingId)}/location`).then(
              (result) => {
                if (current()) {
                  setLocation(result);
                  if (authState !== "authenticated") setDirectory(result.directory);
                }
              },
            )
          : api<Directory>(`/recordings/filesystem?path=${encodeURIComponent(path ?? "")}`).then(
              (result) => {
                if (current()) setDirectory(result);
              },
            );
      request
        .catch((e) => {
          if (current()) setError(String(e));
        })
        .finally(() => {
          if (current()) setLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [path, recordingId, retry, api, authState, generation, isCurrentGeneration]);
  const crumbs = directory?.path.split("/").filter(Boolean) ?? [];
  const entries =
    directory?.entries.filter((entry) => !onSelect || entry.kind === "directory") ?? [];
  return (
    <dialog
      ref={dialog}
      className="recording-browser"
      aria-labelledby="recording-browser-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="section-heading">
        <h2 id="recording-browser-title">
          {onSelect ? "Select recording folder" : "Recording location"}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close recording browser">
          Close
        </button>
      </div>
      <p>Server recording storage</p>
      {location && (
        <p role="status">
          {
            {
              available: "Available",
              file_not_found: "File not found",
              directory_unavailable: "Directory unavailable",
            }[location.status]
          }
          {location.file ? ` - ${location.file}` : ""}
        </p>
      )}
      {metadataOnly && location && (
        <dl>
          <dt>Relative folder</dt>
          <dd>{location.subdir || "/"}</dd>
          {location.size !== undefined && (
            <>
              <dt>File size</dt>
              <dd>{location.size} bytes</dd>
            </>
          )}
        </dl>
      )}
      {authState === "authenticated" && !recordingId && (
        <p>Enter relative recording paths manually in authenticated mode.</p>
      )}
      {!metadataOnly && (
        <nav aria-label="Recording folder breadcrumbs" className="folder-breadcrumbs">
          <button type="button" onClick={() => setPath("")}>
            Recordings root
          </button>
          {crumbs.map((name, index) => (
            <button
              type="button"
              key={index}
              onClick={() => setPath(crumbs.slice(0, index + 1).join("/"))}
            >
              {name}
            </button>
          ))}
        </nav>
      )}
      {loading && <p role="status">Loading folders...</p>}
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
      {!loading && directory && (
        <>
          <p>
            Current directory: <code>{directory.path || "Recordings root"}</code>
          </p>
          {entries.length ? (
            <ul className="folder-entries">
              {entries.map((entry) => (
                <li key={entry.path}>
                  {entry.kind === "directory" ? (
                    <button type="button" onClick={() => setPath(entry.path)}>
                      {entry.name}/
                    </button>
                  ) : (
                    <span className={entry.name === location?.file ? "selected-file" : ""}>
                      {entry.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>{onSelect ? "No subdirectories." : "This directory is empty."}</p>
          )}
          {directory.truncated && (
            <p role="status">
              Showing the first 1,000 entries. Use the manual folder field for an unlisted
              directory.
            </p>
          )}
          {onSelect && !directory.path && (
            <p className="note">
              The root has no folder override. Selecting it uses the existing channel-name default.
            </p>
          )}
        </>
      )}
      <div className="folder-actions">
        <button type="button" onClick={onClose}>
          {onSelect ? "Cancel" : "Close"}
        </button>
        {onSelect && (
          <button
            type="button"
            className="primary"
            disabled={loading || !directory || !!error}
            onClick={() => {
              if (directory) {
                onSelect(directory.path);
                onClose();
              }
            }}
          >
            Select current directory
          </button>
        )}
      </div>
    </dialog>
  );
}
