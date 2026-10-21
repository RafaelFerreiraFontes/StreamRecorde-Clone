---
name: Wave 05.5 — Task 03 — Authentication and Session Lifecycle
wave: "05.5"
order: 03
depends_on:
  - 02-user-schema-migration.task.md
status: planned
---

# Wave 05.5 — Task 03 — Authentication and Session Lifecycle

## Status and Preconditions

Planned only; implementation has not started. Read the [wave specification](README.md), project/MVP instructions and the accepted predecessor deliverables. Wait for predecessor validation, independent review and human acceptance under the existing lifecycle. Creating this task does not authorize its execution.

T01's accepted authentication-ownership-decisions.md is required. If it is missing or a relevant decision is unresolved, return to Coordinator review rather than inventing a policy.

## Context / Objective

Implement the accepted identity resolver, credential verification and session lifecycle while keeping incomplete authenticated operation gated.

## Scope / Required Changes

- Create bounded User/authentication modules and request principal contracts. Resolve the local account server-side only in explicit local mode.
- Implement the T01 hashing choice, credential provisioning/enrollment policy and input validation. Store no plaintext passwords or shared default credential; never return hashes.
- Implement only the accepted auth endpoints, including current identity, login and logout as applicable. Public registration is allowed only if explicitly accepted in T01.
- Implement session/token expiry, revocation and restart semantics. Configure secure transport/cookies as appropriate to local HTTP and future HTTPS without hardcoded secrets.
- Enforce brute-force controls and the chosen CSRF/origin policy, including direct API requests and missing-origin cases. Return bounded errors without account/secret leakage.
- Separate internal Worker credentials from user sessions. Public health exposes no account data; identity failure or database outage never becomes local-user fallback.
- Expose an integration seam for T04 and T06, but keep authenticated domain operation unavailable until required authorization and filesystem gates pass.

## Relevant Areas

api/src/app.module.ts, api/src/main.ts, database schema/repositories and new bounded user/auth modules and tests.

## Explicit Exclusions and Activation Boundary

All wave-wide exclusions apply. No normal-installation cutover, real-data migration, media changes, deployment, staging, commit or push is authorized by this task file. Implement only the current checkpoint; do not advance later tasks automatically. Preserve JSON compatibility according to T01 and keep incomplete authenticated operation disabled.

## Acceptance Criteria

- [ ] Local mode resolves the stable account without mandatory login.
- [ ] Invalid credentials, expired/revoked sessions and missing identity fail closed.
- [ ] Logout and restart behave as accepted; session material and hashes are absent from responses/logs.
- [ ] Rate limiting, input validation, transport and CSRF policy have focused positive/negative tests.
- [ ] Internal service credentials cannot be used as a normal user session; incomplete authenticated mode stays gated.

## Automated Tests / Verification

Run focused API credential/session/identity tests with deterministic time and isolated persistence, then affected API suite/typecheck/build and git diff --check. Test database unavailability and repeated logout.

Use current scripts/frameworks; resolve exact safe commands during planning. No live platforms or real user data as fixtures. Dependencies/images may require separate preparation. Report unavailable prerequisites honestly; do not replace required database/integration evidence with mocks.

## Risks / Recovery

Session format/configuration changes require explicit recovery and invalidation policy. Never recover authenticated requests by impersonating the local user.

## Notes for Coordinator / Sol / Terra / Luna

Coordinator checks branch, working tree and scope before delegation. Sol plans this checkpoint against accepted decisions; Terra implements only the approved plan. Coordinator runs objective validation before Luna independently reviews acceptance, scope and compatibility. Keep planned -> implement -> review/QA -> user-approve -> done, with fixing/coordinator-review paths and existing separate diagnostic/review limits. No automatic acceptance or commit is implied.
