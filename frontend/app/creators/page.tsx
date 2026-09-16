"use client";
import { useEffect, useState } from "react";
import { useDashboard } from "@/components/provider";
import { api } from "@/lib/api";
import { Badge, Empty, Json, ResourceStatus, Table } from "@/components/ui";
import type { Creator, WatchTarget } from "@/lib/types";
function CreatorRow({ creator }: { creator: Creator }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<WatchTarget[]>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const { snapshot } = useDashboard();
  useEffect(() => {
    if (!open) return;
    let active = true;
    api<WatchTarget[]>(
      `/creators/${encodeURIComponent(creator.id)}/watch-targets`,
    )
      .then((data) => {
        if (active) {
          setTargets(data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [open, creator.id, snapshot["watch-targets"].updated, retry]);
  return (
    <section className="panel creator">
      <button
        className="creator-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong>{creator.display_name}</strong>
          <code className="subtext">{creator.id}</code>
        </span>
        <span>{open ? "− Collapse" : "+ Watch targets"}</span>
      </button>
      {open && (
        <div className="creator-children">
          {error && (
            <div className="error" role="alert">
              <pre>{error}</pre>
              <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
            </div>
          )}
          {!targets && !error && <Empty>Loading Creator watch targets…</Empty>}
          {targets &&
            (targets.length ? (
              <Table headings={["WatchTarget", "Platform", "State", "Quality"]}>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      ↳ {t.channel_name}
                      <code className="subtext">{t.id}</code>
                    </td>
                    <td>{t.platform}</td>
                    <td>
                      <Badge state={t.state} />
                    </td>
                    <td>{t.quality}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>No associated watch targets.</Empty>
            ))}
        </div>
      )}
    </section>
  );
}
export default function Creators() {
  const { snapshot } = useDashboard();
  const data = snapshot.creators.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Domain / Grouped identities</div>
          <h1>Creators</h1>
          <p>
            One Creator can have multiple WatchTargets across Twitch, YouTube
            and Kick.
          </p>
        </div>
      </div>
      <ResourceStatus resource="creators" />
      {data?.map((c) => (
        <CreatorRow key={c.id} creator={c} />
      ))}
      {data?.length === 0 && (
        <Empty>
          No Creators yet. Create a WatchTarget to establish a Creator.
        </Empty>
      )}
      <p className="note">
        Creator IDs are currently derived from display names. Expand a Creator
        to query its WatchTargets.
      </p>
      {data && <Json data={data} />}
    </>
  );
}
