---
name: Wave 05.5 — Task 08 — Frontend Origin Validation Security Hotfix
wave: "05.5"
order: 08
depends_on:
  - 07-wave-integration-qa-documentation.task.md
status: done
---

# Wave 05.5 — Task 08 — Frontend Origin Validation Security Hotfix

## Status and Objective

Status: `done`.

Harden the Next.js reverse-proxy origin validation for authenticated and local operations, preventing CSRF bypass, Host header injection, and port/scheme confusion while allowing legitimate browser requests across configured origins, localhost, and 127.0.0.1.

## Context and Root Cause

During local deployment of Wave 05.5 in Mode C (`IDENTITY_MODE=authenticated`), logins through the frontend reverse proxy failed with HTTP 403 (`Cross-origin mutation rejected`) even when `AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3001` was configured on the NestJS API.

Investigation revealed:
1. In Next.js App Router route handlers, `request.nextUrl.origin` is evaluated from internal server host/port (e.g. `http://0.0.0.0:3001` or `http://localhost:3001` in Docker / standalone runtime), which diverges from the browser's origin (`http://127.0.0.1:3001`).
2. The initial uncommitted hotfix replaced `parsed.origin === request.nextUrl.origin` with a check against `FRONTEND_TRUSTED_ORIGINS` and `parsed.host === host`. However:
   - When `FRONTEND_TRUSTED_ORIGINS` is not set (e.g. in Mode A/B or development), all mutations were rejected with 403.
   - If `Host` header is missing or unverified, requests could fail or be vulnerable.
   - Existing unit test `tests/usability.test.mjs` failed because `Host` was not set in mocked requests and `FRONTEND_TRUSTED_ORIGINS` was unset.
   - Missing `Origin` header handling was permissive in HEAD and strict in the draft, requiring safe, consistent policy.

## Acceptance Criteria

1. **Origin Verification Robustness**:
   - Explicit allowlist via `FRONTEND_TRUSTED_ORIGINS` (comma-separated origins).
   - Safe default fallback for local development/operation when `FRONTEND_TRUSTED_ORIGINS` is not set: permit same-host mutations if the request `Origin` matches the request `Host` header (with valid `http:` or `https:` scheme) and matches standard local origins (`http://localhost:3001`, `http://127.0.0.1:3001`, or local port variants).
   - Parse and validate `Origin` strictly (valid scheme, no userinfo, origin matches normalized URL origin, no wildcards).
   - Strict port and scheme matching.
   - Host Header Injection protection: verify `Host` against trusted origins or known allowed hosts.
   - Rejection of cross-origin mutations (403 `Cross-origin mutation rejected`).
   - Missing `Origin` on mutation requests (POST/PATCH/DELETE) must be safely handled (fail-closed for mutations or require valid same-origin Referer fallback without userinfo).
2. **Session and Cookie Integrity**:
   - `sr_session` cookie forwarding remains strictly validated (`^[A-Za-z0-9_-]{43}$`).
   - `Set-Cookie` relayed only on auth routes (`login`, `logout`).
   - No credentials or session tokens in diagnostics or error logs.
3. **Automated Test Coverage**:
   - Add comprehensive tests in `frontend/tests/` covering:
     - Allowed legitimate origin (`127.0.0.1:3001` and `localhost:3001`).
     - Configured custom origin in `FRONTEND_TRUSTED_ORIGINS`.
     - Untrusted origin (403).
     - Divergent port (403).
     - Divergent scheme (rejected).
     - Malformed origin (rejected).
     - Host header injection / spoofing.
     - Missing Origin on mutation (safe behavior).
     - Existing proxy tests (`usability.test.mjs`, `client.test.mjs`, `health-route.test.mjs`, `proxy-unavailable.test.mjs`, `auth-session.test.tsx`) pass 100%.
4. **Environment and Documentation**:
   - Update `compose.authenticated.yml` to pass `FRONTEND_TRUSTED_ORIGINS`.
   - Update `.env.example` and `frontend/README.md` to document the origin configuration.
5. **Quality Gates**:
   - `pnpm --dir frontend test` passes.
   - `pnpm --dir frontend typecheck` passes.
   - `pnpm --dir frontend build` passes.
   - `pnpm lint` and `pnpm format:check` pass.
