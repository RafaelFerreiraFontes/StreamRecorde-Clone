# Wave 05.5 — User, Authentication and Ownership

## Status and Objective

Planned. All seven task files are specifications only; no task has started. This README is the umbrella specification, not an eighth executable task.

Introduce stable User identity, a low-friction local account, credential/session handling and backend resource isolation. Local Mode remains primary; authenticated operation is a capability to validate locally, not authorization for hosted deployment.

## Baseline and Evidence

Planning baseline: master at 28e42a1b8b96724b3e1eb7f057b836b65bf8a7f5 (post-Wave 05). Recheck the actual branch and changes when execution is authorized.

- PostgreSQL 17, Drizzle migrations and relational Creator/WatchTarget/Stream/Recording persistence exist.
- Default Compose remains JSON-authoritative: RELATIONAL_STORAGE=false and Worker PERSISTENCE_MODE=direct_json. PostgreSQL presence does not attest installation cutover.
- Relational bridge mode uses token-protected internal API routes, transactional event acknowledgment and durable Worker outbox/checkpoints.
- User, human authentication, sessions and ownership are not implemented.
- Public domain/legacy controllers and repositories do not receive a user principal.
- The Next.js proxy currently does not carry a user session; dashboard snapshots survive request errors.
- Filesystem browsing is read-only and root-contained but not isolated by user; location responses can include sibling filenames.
- Existing imported Recordings may have NULL stream_id. Preserve IDs, raw historical timestamps and unknown relationships.
- No tests were run as part of creating these planning documents. Prior Wave 05 evidence is recorded in PROJECT-STATUS.md, not re-certified here.

## Tasks and Dependencies

| Order | Task | Depends on | Status |
| --- | --- | --- | --- |
| 01 | [Identity, Authentication and Ownership Decisions](01-authentication-ownership-decisions.task.md) | Wave 05 completion | planned |
| 02 | [User Schema, Local Account and Ownership Migration](02-user-schema-migration.task.md) | 05.5-T01 | planned |
| 03 | [Authentication and Session Lifecycle](03-authentication-session.task.md) | 05.5-T02 | planned |
| 04 | [Domain Ownership and Legacy Route Authorization](04-domain-authorization.task.md) | 05.5-T03 | planned |
| 05 | [Worker Ownership and Filesystem Access Boundaries](05-worker-filesystem-ownership.task.md) | 05.5-T04 | planned |
| 06 | [Frontend Identity, Proxy and Session UX](06-frontend-authentication.task.md) | 05.5-T05 | planned |
| 07 | [Wave Integration QA and Operational Documentation](07-wave-integration-qa-documentation.task.md) | 05.5-T06 | planned |

Execute sequentially: T01 decisions -> T02 schema/migration -> T03 authentication -> T04 domain authorization -> T05 Worker/filesystem -> T06 frontend -> T07 integration/documentation. A completed implementation is not accepted dependency evidence; follow validation, review and human acceptance gates.

T01 must produce authentication-ownership-decisions.md when it is actually executed. That decision record is intentionally not fabricated by this planning change.

## Decisions Required Before Implementation

T01 freezes the persistence/identity mode matrix, local-account fields/bootstrap/enrollment, email policy, provisioning, password hashing, session/token lifecycle, route access classes, ownership representation/constraints, account disablement, filesystem isolation and migration/rollback contracts.

Starting recommendation: legacy JSON remains a documented single-user compatibility mode; new User/auth/ownership capabilities use PostgreSQL. Local mode resolves a persistent local principal without mandatory interactive login. Authenticated mode never falls back to that principal. These are planning proposals for T01 to resolve, not implemented flags or a silent cutover.

## Cross-Task Safety and Compatibility

- Ownership comes from a verified server-side principal, never a client-selected owner field.
- Enforce isolation in services/queries and relational integrity, covering modern/legacy routes, filters, names, archival history and filesystem metadata.
- If owner fields are duplicated, enforce parent/child consistency. NULL legacy stream links must not bypass Recording authorization.
- Keep Worker service identity separate from human sessions. Preserve replay and terminal persistence during logout, outage and account-status changes according to accepted policy.
- Prevent directory/sibling filename disclosure; checking only a Recording ID is insufficient.
- Clear frontend snapshots and invalidate pending requests on identity change/logout/authentication loss.
- Prepare both populated relational upgrades and JSON imports. Preserve manifests, IDs, timestamps, media paths, history and idempotence; detect ownership-mapping conflicts.
- New migrations are additive/reviewable; do not rewrite applied migrations. No automatic import or storage authority switch at startup.
- Intermediate tasks may provide disabled/isolated seams. Do not expose partially protected authenticated operation before all required boundaries pass.
- Keep independent target settings, current idle/offline/recording/finished/error vocabulary, session_id compatibility, private local output and existing filesystem/process protections.
- Preserve ordinary runtime-data, recordings, outbox/checkpoints, database volumes and local configuration. Never use them as fixtures.

## Out of Scope

Redis/BullMQ/jobs (06), Tags (06.5), general file-management/retention (07/07.5 and later), SSE/heartbeat (08), Tauri (08.5), cloud OAuth/export/providers, invite limits (11), hosted deployment (12), public media, complex RBAC/admin systems, email delivery/verification, password recovery and MFA. Do not add public signup by assumption; T01 must define the minimum controlled account-provisioning path.

## Acceptance Matrix

| Requirement | Decision | Implementation | Final evidence |
| --- | --- | --- | --- |
| Modes, local identity and activation gates | T01 | T02/T03/T06 | T07 |
| User schema, ownership constraints, upgrade/import/replay | T01 | T02 | T07 |
| Passwords, sessions, logout, expiry, CSRF and abuse controls | T01 | T03/T06 | T07 |
| Two-user isolation, modern/legacy routes and history | T01 | T04 | T07 |
| Service identity, replay, account state and capture continuity | T01 | T05 | T07 |
| Directory and sibling metadata isolation | T01 | T05 | T07 |
| Proxy transport and stale-response/account-switch handling | T01 | T06 | T07 |

## Validation and Agent Workflow

Follow [project instructions](../../instructions/project.instructions.md), [MVP instructions](../../instructions/mvp.instructions.md), [project status](../../../PROJECT-STATUS.md) and [database runbook](../../../api/README.database.md).

Coordinator -> Sol -> Terra -> Coordinator validation -> Luna -> Coordinator -> human acceptance. Preserve planned/implement/review-QA/user-approve/done semantics and fixing/coordinator-review paths exactly as defined in project instructions; the literal task review status is review/QA. Do not mark tasks done or start a successor merely because these files exist.

Select relevant repository skills: task-preflight for scope/Git; domain-contracts and postgres-persistence for T01/T02/T04; security-compliance for authentication/authorization; worker-lifecycle for T05; api-frontend for T04-T06; docker-validation and review-gate for isolated integration and independent review. Skills do not expand authorization.

Use focused tests during implementation and required affected/full suites at the established gates. Validate two distinct users and negative access attempts against real isolated PostgreSQL where applicable. Rehearse fresh install, relational upgrade, legacy import, local/authenticated modes and failures. Use fake Streamlink and private disposable storage; no network/live streams are test fixtures. Required skipped/blocked checks are not passing evidence.

For this document-creation change only: validate frontmatter/status/dependencies, relative links, scope, obsolete baseline statements and git diff --check. Do not run application suites or migrations merely to create tasks. No automatic staging, commit or push.
