# Environments, security and release operations

## Current environment

Local-first work is approved. No hosted resources, remote frontend repository, live payment activation or persistent database migrations are created by F00. The Vite server binds loopback at 5173; production preview uses 4173. Strict ports avoid accidentally testing a different process. HTTPS/origin/cookie behavior still needs actual hosted verification later.

The backend has ordinary `darve-backend` Docker services and an isolated `darve-staging` group. The ordinary database's recorded schema is 35; the isolated candidate has later migrations and restricted runtime roles. Never start both blindly, point the frontend at an arbitrary API, migrate ordinary storage, share credentials or assume a stopped group is unhealthy. F02 must inspect actual current source/schema/process state, choose the appropriate isolated backend and document route-level proxy/origin behavior. F00 makes no backend connection and starts no containers.

F02-02 supplies a separate [disposable local API composition](LOCAL_API_COMPOSITION.md): fresh labelled tmpfs PostgreSQL/Redis, all pinned-source migrations and direct CORS from explicit loopback Origins. It does not start or migrate either existing Compose group. Its acceptance fixture is synthetic identity/session preparation against the actual API, not provider login. Task-owned storage is removed after checks.

`services/config/environment.ts` accepts browser-public `VITE_APP_ENV` with local/staging/production values and optional `VITE_PUBLIC_API_ORIGIN`. The latter is an exact HTTPS origin without path/credentials/query/fragment; HTTP is allowed only on loopback in local mode. Omit it for an offline presentation preview. Unknown `VITE_*` keys fail validation without printing their contents. Vite still embeds variables referenced by code: the parser is a guardrail, not a secret scanner. Never put credentials in frontend env files at all. No provider key, Resend credential, staff encryption key, donor record, token or private grant is committed. Keep environment files, artifacts and test reports ignored.

## Separate staff entry

F08-03 adds `npm run dev:staff` at `http://localhost:5176` and `npm run preview:staff` at `http://localhost:4176`. `npm run build` typechecks once and produces the public/overlay `dist` plus independent `dist-staff`; the staff output contains no public/overlay HTML entry. Do not serve it as a public app `/admin` route. Actual hosting/ingress remains a deployment gate.

Staff settings belong in ignored `env/staff/.env.local`, using [its example](../env/staff/.env.example): `STAFF_PUBLIC_APP_ENV`, paired `STAFF_PUBLIC_API_ORIGIN` and `STAFF_PUBLIC_AUTHORIZATION_ENDPOINT`. The prefix is browser-visible and strictly allowlisted. Omit both addresses for the unavailable/no-request state. Configure them only to match the actual reviewed backend `ADMIN_API_ORIGIN`, `ADMIN_FRONTEND_ORIGIN` and registered callback/authorization endpoint. No Auth0 secret, password, code, Resend key or encryption material belongs here. HTTPS is required outside local loopback configuration. Local creator hosts use `127.0.0.1` and staff frontend/API use `localhost`; different ports alone do not isolate cookies. Default commands do not start an admin API or configure a provider/sender.

The [F08 owner](F08_STAFF_AND_SUPPORT_IMPLEMENTATION.md#f08-03-staff-entry-and-authority) reviews the content-free sign-out intent flag as the sole staff storage use. Proofs/codes/private records remain in memory. `npm run test:staff:local` composes only fresh labelled tmpfs SQL/Redis, constrained roles, local admin HTTP and loopback code delivery against the exact backend pin; it uses an explicit controlled identity port and cleans its own resources. It never reads an ordinary database/provider environment or sends managed email. Its local preview header proof is not actual hosted HTTPS acceptance.

## Feature flags and observability

No flag vendor or external telemetry integration is installed. Planned UI flags are typed, documented, fail-closed and subordinate to backend availability/authorization. Build-time flags are public. Server feature activation, prices, permissions and receiving readiness cannot be overridden by a browser setting.

Add telemetry only when useful: safe event name/category, approved timing and safe request ID. Exclude raw errors/bodies, cookies, authorization headers, URL query/fragment, donor identities, support content and private contribution/receipt/grant URLs. Scrub before console/reporter transport; test the scrub policy. Do not report every financial polling attempt as a successful payment. Source maps remain off in public builds; any future private source-map upload needs controlled access.

Playwright captures traces/screenshots/video only under a deliberately reviewed policy. F00 disables them by default; its safe shell tests can be visually inspected with local screenshots. Hosted failure reports have three-day retention, contain synthetic shell cases and must be reviewed before tests expand to private/provider flows.

## Deployment preparation

The [deployment-preparation checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md) owns all deferred hosting, real identity/mail/provider, custody, retention, workload and final activation requirements. It retains the confirmed Resend selection and existing backend owners. Do not duplicate checkboxes or infer completion from local frontend work.

## Release handoff

[GIT_AND_CI_SETUP](GIT_AND_CI_SETUP.md) owns the actual hook/CI setup, remote/protection gaps, task review/cleanup and release procedure. [WORKFLOW](WORKFLOW.md) owns verification selection and restart handoff. This document owns runtime/environment policy rather than another CI/status ledger.

Deployment later must choose a static asset host/container, deep-link fallback, immutable asset caching and non-stale HTML/config delivery; separate public/staff/OBS ingress as required by contracts. Verify TLS, CSP, frame/embedding policy, cookie attributes, CORS/CSRF, referrer handling and route-specific caching on the actual host. Payments/identity use backend verified endpoints; frontend hosting is not another business backend.

Record frontend artifact digest, backend compatibility, source and contract revisions, public config and operator/recovery procedure. Do not promise frontend rollback will undo schema changes or provider effects. A release record is not deployment permission. Provider actions, migrations, sandbox payments and production activation retain their own coordinated scope.
