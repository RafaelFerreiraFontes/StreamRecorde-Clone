---
name: Wave 05.5 — Task 06 — Frontend Identity, Proxy and Session UX
wave: "05.5"
order: 06
depends_on:
  - 05.5-repository-linting-code-readability.task.md
status: done
---

# Wave 05.5 — Task 06 — Frontend Identity, Proxy and Session UX

## Status and Preconditions

Task 06 implementation is complete and formally approved on 2026-10-22 against the accepted [wave specification](README.md), project/MVP instructions and accepted T01–T05.5 deliverables.
- Next.js proxy allowlist extended for `/auth/session`, `/auth/login` and `/auth/logout` with safe `sr_session` forwarding, `Origin`/`Referer` forwarding and auth-only `Set-Cookie` relay.
- Local and authenticated frontend session resolution, login/logout recovery, request-generation cancellation, snapshot/diagnostic invalidation and mode-aware Recording location UX implemented.
- All required validation gates passed (lint, format, frontend typecheck/build/38 tests, API typecheck/179 tests, isolated PostgreSQL 80 tests and Docker bridge smoke).
- Luna Review 2 returned PASS.
- Human acceptance explicitly granted. Authenticated production mode remains disabled until Task 07.

T01's accepted authentication-ownership-decisions.md is required. If it is missing or a relevant decision is unresolved, return to Coordinator review rather than inventing a policy.

## Context / Objective

Integrate local and authenticated experiences through the existing Next.js proxy without exposing credentials or stale cross-account data.

## Scope / Required Changes

- Implement current-identity loading and the accepted login/logout/provisioning UX. Local mode opens the dashboard without a mandatory login screen.
- Extend the proxy allowlist only for accepted auth routes; forward required cookie/authorization material and response cookies deliberately. Preserve no-store, bounded timeouts and internal-route exclusion.
- Match the API CSRF/origin and cookie policy, including logout and session renewal where selected. Never forward arbitrary credentials or INTERNAL_API_TOKEN.
- Clear all dashboard snapshots on logout, identity change or authentication loss. Cancel or invalidate in-flight refreshes so older responses cannot restore another account's data.
- Distinguish 401/authentication loss, authorization/not-found, backend unavailability and expired session. Do not silently select the local account.
- Preserve target edits, polling, stale-data UX within the same authorized identity, safe folder browsing and mutation reconciliation.
- Keep provisioning limited to T01 scope; do not add public signup, password recovery, cloud OAuth or a new admin UI by assumption.

## Relevant Areas

frontend/app/api/backend/[...path]/route.ts, frontend/components/provider.tsx, frontend/lib/api.ts, layout/shell and frontend tests.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [x] Local dashboard remains usable without interactive login; authenticated dashboard requires valid identity.
- [x] Proxy preserves the accepted credential/session lifecycle without exposing service secrets.
- [x] Logout/user switch/401 clears data, including delayed concurrent responses.
- [x] Two-user UI tests show no stale identity or resource leakage.
- [x] Existing dashboard/proxy/component behavior remains compatible under the accepted modes.

## Automated Tests / Verification

Run the read-only lint and format checks established by T05.5 for all affected files; fix findings explicitly without weakening the accepted policy. Run focused proxy and component tests for login/logout, cookie propagation, CSRF, 401, delayed requests and account switching. Run frontend package test scripts, typecheck/build and affected API integration tests; record exact commands and git diff --check.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Do not use UI hiding as authorization. Keep authenticated rollout gated until end-to-end checks confirm backend, proxy and filesystem protections.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
