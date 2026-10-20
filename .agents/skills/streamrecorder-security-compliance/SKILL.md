---
name: streamrecorder-security-compliance
description: Audit StreamRecorder privacy, secret handling, path containment, and platform-access risks when changing recording storage, filesystem paths, URL validation, logs, media exposure/download/playback, credentials, OAuth, authentication, cloud integration, or deployment.
---

# Security and compliance audit

## Purpose and use

Trace sensitive data and authority across a proposed or implemented boundary. Use for exposure, credentials, filesystem safety, and platform-access changes rather than general implementation readiness.

## Read first

- [Project instructions](../../../.github/instructions/project.instructions.md), [MVP instructions](../../../.github/instructions/mvp.instructions.md), concrete task, and [project status](../../../PROJECT-STATUS.md) for implemented versus future features.
- Affected code/tests; for local storage inspect [filesystem service](../../../api/src/streams/recordings-filesystem.service.ts), [API service](../../../api/src/streams/streams.service.ts), [Worker path/log/process helpers](../../../worker/worker.py), and [Compose mounts](../../../compose.yml).
- For exposure changes inspect the [frontend proxy](../../../frontend/app/api/backend/%5B...path%5D/route.ts) and actual API routes, rather than trusting UI restrictions.

## Procedure

1. Identify assets (private recordings, metadata, URLs, credentials), callers, trust boundaries, and effective read/write privileges. Confirm the feature belongs to the authorized phase; a request mentioning OAuth/cloud/auth is not permission to invent their architecture or implement unrelated waves.
2. Trace recording locations from user input and persisted metadata to filesystem operations and API output. Test traversal, absolute/drive/UNC paths, encoded separators, malformed inputs, symlink/junction escapes, and root containment with disposable fixtures. Validation must survive the actual filesystem resolution, not only string normalization.
3. Check that recording storage remains private and user-controlled. Look for accidental static serving, public indexing, download/playback routes, host-path disclosure, or broader proxy exposure. Metadata browsing must not become public media access.
4. Trace URLs and error/log paths for embedded credentials, query secrets, raw platform responses, Authorization headers, access/refresh tokens, and sensitive diagnostics. Use synthetic secret markers to test redaction. Inspect only relevant changed/config-example files for committed secrets; do not read real credential stores or print secret values.
5. When authorized authentication/OAuth exists, verify backend authorization and user isolation, least-privilege provider scopes, protected/encrypted token storage, and exclusion of tokens from responses/logs/jobs/Git. When absent, report the boundary honestly rather than adding speculative auth/cloud functionality.
6. Review service/filesystem privileges, cleanup ownership, bounded retries/logging/storage, and resource cost. Preserve simple local/VPS-safe operation. Valid local media must survive secondary metadata/export failure; cleanup requires explicit ownership and policy.
7. Confirm platform access is authorized and does not bypass access controls. Preserve the project's user responsibility for copyright/platform compliance; report missing applicable product safeguards without pretending this audit establishes legal clearance.

## Validation and expected result

Run relevant containment, URL, secret-redaction, privilege, and exposure negative tests using isolated fixtures. Use Docker validation for mounts/identities and review-gate for overall readiness when helpful, without making either a dependency. Return sensitive data flows, tested threats, findings with file/symbol evidence and scoped remediation, commands/results, and unverified deployment/provider assumptions. Never send private data externally, download arbitrary tooling, modify global configuration, or auto-approve dangerous operations as part of the audit.
