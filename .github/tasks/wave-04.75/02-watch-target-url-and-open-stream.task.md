---
name: Wave 04.75.2 WatchTarget URL Editing and Open Stream
wave: 04.75
order: 02
status: done
---

# Wave 04.75.2 — WatchTarget URL Editing and Open Stream

## Status

review/QA

## Context

The durable WatchTarget `url` is already present in domain, adapter, JSON, creation form, and Worker polling. The existing UI table does not show it, and PATCH cannot update it. The Worker deliberately blocks launch when the URL changes during a probe.

## Problem

An existing monitoring target cannot be pointed to a corrected public channel page, and users have no safe direct shortcut from the target to that page.

## Objective

Allow safe editing of the persisted WatchTarget URL through the current PATCH endpoint and add a browser-only Open Stream action that uses that exact persisted URL.

## Scope

### In Scope

- PATCH URL validation, persistence, adapter compatibility, API tests.
- Compact URL editing/display in Watch Targets and a safe external-link action.
- Existing component-test setup coverage.

### Out of Scope

- URL derivation from platform/channel name, backend fetching/proxying, SSRF/fetch facilities, platform scraping, authentication changes, downloads, or Worker refactors.

## Current Architecture

- `url` is a required string in `api/src/streams/domain.model.ts`, `CreateWatchTargetDto`, `WatchTargetJsonAdapter`, and watchlist entries.
- Patch filtering is in `api/src/streams/dto/watch-target.dto.ts` and `api/src/streams/streams.service.ts`; persistence is `StreamsRepository.updateWatchTarget`.
- The Worker reads `entry["url"]`, probes it in `is_live()`, and re-reads the target before `start_recording()` in `worker/worker.py`.
- The create form already applies browser-side HTTP(S), no-userinfo validation in `frontend/app/watch-targets/page.tsx`; frontend calls use the existing API proxy.

## Required Changes

- Add optional URL support to the existing PATCH DTO, allowlist, service validation, and atomic repository mutation. Apply minimum URL validation: string, valid absolute HTTP/HTTPS URL, no username/password. Match/create validation behavior where feasible and reject malformed/non-HTTP(S) values with no write.
- Preserve exact persisted URL authority for the Worker; do not rederive it from `platform + channel_name`, even after an edit.
- Add a compact URL presentation/edit mechanism that does not make the table excessively wide (a labeled Edit action with an inline editor, dialog, or popover is acceptable). Long values must truncate/wrap safely while preserving accessible identification; saving uses only `{ url }`, has pending/error state, and refetches/reconciles after success/failure.
- Add an Open Stream/Open Page external link adjacent to Channel/ID or Actions. It uses `t.url` directly, opens in a new tab with `target="_blank"` and `rel="noopener noreferrer"`, and has no backend request beyond ordinary existing data loading.
- Render the action absent/disabled for missing or invalid stored URL. Client-side validation is UX defense; API remains authoritative. Do not log URL query strings, tokens, credentials, cookies, or raw URL diagnostics.
- Preserve the Worker’s existing pre-launch URL-change gate; document that a successful PATCH takes effect at a later config reload and a probe in flight may be conservatively blocked/retried.

## Behavioral Contract

| Event | Required result |
| --- | --- |
| Valid HTTPS/HTTP PATCH | Exact URL is persisted and returned by GET/refetch |
| Invalid scheme, malformed URL, or userinfo | 400/no partial JSON mutation |
| Open Stream valid URL | Browser opens persisted public URL in a separate protected context |
| Missing/invalid stored URL | No operable external link |
| URL changes during Worker probe | Existing Worker blocks that launch; no stale URL capture |

## Acceptance Criteria

- [ ] PATCH updates URL atomically and preserves all unrelated WatchTarget fields/siblings.
- [ ] URL validation rejects non-HTTP(S), malformed, and credential-bearing inputs.
- [ ] Adapter read/write and legacy JSON compatibility retain URL exactly.
- [ ] The UI supports accessible compact editing, saving state, error feedback, and post-save refetch.
- [ ] Open Stream uses only the persisted URL with `_blank` plus `noopener noreferrer`.
- [ ] No API endpoint fetches, proxies, downloads, or exposes any external content/recording.

## Automated Tests

- API tests: PATCH valid HTTP/HTTPS URL; invalid protocol/parse/userinfo/type; no partial writes; JSON/adapters preserve URL/quality/enabled/subdir and siblings.
- Component tests: URL edit payload, loading/error rollback/reconciliation, visual validation feedback, safe link attributes/href, and disabled/absent behavior for invalid/missing URL.
- Regression test the existing Worker URL-change refresh guard if an API fixture or call shape changes.

## Manual Verification

Edit a target to a permitted public URL, reload, and use Open Stream to confirm a new browser tab receives the same URL. Verify invalid URLs do not save and that no request is made to a backend URL-fetch route.

## Verification Commands

- `cd api; pnpm test -- --runInBand`
- `cd api; pnpm exec tsc --noEmit`
- `cd frontend; pnpm test`
- `cd frontend; pnpm typecheck`
- `cd frontend; pnpm build`
- `python -m pytest worker/test_worker.py`
- `docker compose config --quiet`
- `git diff --check`

## Dependencies

Independent of 04.75.1 and 04.75.3, but must preserve the URL re-read behavior used by 04.75.4.

## Risks / Regression Risks

Treating a user URL as a server fetch target creates an SSRF surface; this task must never do that. A long URL can degrade table layout. Do not leak query credentials through errors or diagnostics.

## Rollback Considerations

No migration. Reverting UI controls must not rewrite stored URLs. An older Worker continues reading the same JSON field.

## Notes for Coordinator / Sol / Terra / Luna

Sol should confirm the existing client/server URL rules and Worker race behavior. Terra must retain existing proxy-only API calls. Luna should inspect actual anchor attributes and reject any backend relay/fetch addition.
