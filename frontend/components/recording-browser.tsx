"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Directory {
  path: string;
  truncated?: boolean;
  entries: { name: string; path: string; kind: "directory" | "file" }[];
}
interface Location {
  status: "available" | "file_not_found" | "directory_unavailable";
  directory?: Directory;
  file?: string;
}

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
  const dialog = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState<string | null>(
    initialPath ?? (recordingId ? null : ""),
  );
  const [directory, setDirectory] = useState<Directory>();
  const [location, setLocation] = useState<Location>();
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
    let active = true;
    setLoading(true);
    setError("");
    setDirectory(undefined);
    const request =
      path === null && recordingId
        ? api<Location>(
            `/recordings/${encodeURIComponent(recordingId)}/location`,
          ).then((result) => {
            if (active) {
              setLocation(result);
              setDirectory(result.directory);
            }
          })
        : api<Directory>(
            `/recordings/filesystem?path=${encodeURIComponent(path ?? "")}`,
          ).then((result) => {
            if (active) setDirectory(result);
          });
    request
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, recordingId, retry]);
  const crumbs = directory?.path.split("/").filter(Boolean) ?? [];
  const entries =
    directory?.entries.filter(
      (entry) => !onSelect || entry.kind === "directory",
    ) ?? [];
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close recording browser"
        >
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
      <nav
        aria-label="Recording folder breadcrumbs"
        className="folder-breadcrumbs"
      >
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
            Current directory:{" "}
            <code>{directory.path || "Recordings root"}</code>
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
                    <span
                      className={
                        entry.name === location?.file ? "selected-file" : ""
                      }
                    >
                      {entry.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {onSelect ? "No subdirectories." : "This directory is empty."}
            </p>
          )}
          {directory.truncated && (
            <p role="status">
              Showing the first 1,000 entries. Use the manual folder field for
              an unlisted directory.
            </p>
          )}
          {onSelect && !directory.path && (
            <p className="note">
              The root has no folder override. Selecting it uses the existing
              channel-name default.
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
