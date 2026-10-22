---
name: streamrecorder-api-frontend
description: Trace and test StreamRecorder changes across NestJS DTO/controller/service/repository contracts, the Next.js proxy and API client, dashboard polling, WatchTarget/History UI, or recording filesystem browsing.
---

# API and frontend boundary

## Purpose and use

Validate observable behavior from API boundary to dashboard, including changes that can break a consumer even when only one side is edited.

## Read first

- [Project instructions](../../../.github/instructions/project.instructions.md), concrete task, [API README](../../../api/README.md), and [frontend README](../../../frontend/README.md).
- Current [controller](../../../api/src/streams/streams.controller.ts), [DTOs](../../../api/src/streams/dto/), [service](../../../api/src/streams/streams.service.ts), and [repository](../../../api/src/streams/streams.repository.ts).
- [Next.js proxy](../../../frontend/app/api/backend/%5B...path%5D/route.ts), [API client](../../../frontend/lib/api.ts), [domain types](../../../frontend/lib/types.ts), and affected components/provider/tests.
- For browsing, [filesystem service](../../../api/src/streams/recordings-filesystem.service.ts) and its controller/tests.

## Procedure

1. Trace the changed request/response through every boundary. Record method, path, query, input validation, status/error semantics, identifiers, and payload shape from current code; verify modern and legacy APIs where applicable.
2. Keep controllers thin, transport validation at the API boundary, domain behavior in services, persistence in repositories/adapters, and filesystem access behind its dedicated service. Frontend validation supports UX and cannot replace backend validation.
3. Check PATCH omission versus explicit clear, strict booleans, quality/URL/path rules, filters, and error propagation. Use domain-contract procedures when entity identity or legacy mapping also changes.
4. Check the proxy's method/path/query allowlist and cross-origin mutation restrictions for the requested route. Keep `API_BASE_URL` server-side; frontend code consumes API responses and never reads shared JSON directly. Do not broaden the proxy into an arbitrary destination or credential relay.
5. Trace polling/refetch and mutation reconciliation, including overlapping refreshes. Test loading, stale retained data, and errors independently for each affected collection; API health and old state do not prove Worker liveness.
6. For recording browsing, verify root containment, symlink/junction escape rejection, relative logical paths, missing/unavailable states, and read-only metadata responses. Never turn filesystem metadata into a public download/playback/media endpoint.

## Safety / invariants

Do not introduce WebSocket/SSE or unrelated UI redesign outside the authorized phase. Use isolated configuration/storage for mutation tests and keep real Worker activity away from CRUD fixtures. Preserve private recording handling; security-compliance can deepen exposure/path checks when needed.

## Validation and expected result

Select API contract, frontend proxy/component, and isolated HTTP integration tests according to the change. Confirm current package scripts before execution: API supports `pnpm test --runInBand` and `pnpm exec tsc --noEmit`; frontend supports `pnpm test`, `pnpm typecheck`, `pnpm build`, and its guarded integration workflow. Run from the respective component directory. Follow [code-quality guidance](../streamrecorder-code-quality/SKILL.md): root `pnpm lint` and `pnpm format:check` are read-only checks, as are `node scripts/lint-repository.mjs lint <area>` and `node scripts/lint-repository.mjs format:check <area>` for `api` or `frontend`. `lint:fix` and `format:write` are separate mutating commands, not verification gates. Return a boundary map, before/after behavior, compatibility/UX test evidence, command results, and remaining manual checks.
