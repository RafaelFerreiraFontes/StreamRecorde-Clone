"use client";
import { useDashboard, type Resource } from "./provider";
import type { RecordingState } from "@/lib/types";
export function Badge({ state }: { state: RecordingState }) {
  return (
    <span className={`badge ${state}`}>
      <span aria-hidden="true">●</span> {state}
    </span>
  );
}
export function Json({
  data,
  title = "Inspect JSON response",
}: {
  data: unknown;
  title?: string;
}) {
  return (
    <details className="json">
      <summary>{title}</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
export function ResourceStatus({ resource }: { resource: Resource }) {
  const { snapshot, refresh } = useDashboard();
  const item = snapshot[resource];
  return item.error ? (
    <div className="error" role="alert">
      <strong>
        /{resource} failed{item.data ? " · showing last successful data" : ""}
      </strong>
      <pre>{item.error}</pre>
      <button onClick={() => void refresh()}>Retry</button>
    </div>
  ) : !item.data ? (
    <p className="empty" role="status">
      Loading {resource}…
    </p>
  ) : null;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Table({
  headings,
  children,
}: {
  headings: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
