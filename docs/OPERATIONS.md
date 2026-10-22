# Environments, security and release operations

## Current environment

Local-first work is approved. No hosted resources, remote frontend repository, live payment activation or persistent database migrations are created by F00. The Vite server binds loopback at 5173; production preview uses 4173. Strict ports avoid accidentally testing a different process. HTTPS/origin/cookie behavior still needs actual hosted verification later.

The backend has ordinary `darve-backend` Docker services and an isolated `darve-staging` group. The ordinary database's recorded schema is 35; the isolated candidate has later migrations and restricted runtime roles. Never start both blindly, point the frontend at an arbitrary API, migrate ordinary storage, share credentials or assume a stopped group is unhealthy. F02 must inspect actual current source/schema/process state, choose the appropriate isolated backend and document route-level proxy/origin behavior. F00 makes no backend connection and starts no containers.

`services/config/environment.ts` accepts only browser-public `VITE_APP_ENV` with local/staging/production values. Unknown `VITE_*` keys fail validation without printing their contents. Vite still embeds variables referenced by code: the parser is a guardrail, not a secret scanner. Never put credentials in frontend env files at all. No provider key, Resend credential, staff encryption key, donor record, token or private grant is committed. Keep environment files, artifacts and test reports ignored.

## Feature flags and observability

No flag vendor or external telemetry integration is installed. Planned UI flags are typed, documented, fail-closed and subordinate to backend availability/authorization. Build-time flags are public. Server feature activation, prices, permissions and receiving readiness cannot be overridden by a browser setting.

Add telemetry only when useful: safe event name/category, approved timing and safe request ID. Exclude raw errors/bodies, cookies, authorization headers, URL query/fragment, donor identities, support content and private contribution/receipt/grant URLs. Scrub before console/reporter transport; test the scrub policy. Do not report every financial polling attempt as a successful payment. Source maps remain off in public builds; any future private source-map upload needs controlled access.

Playwright captures traces/screenshots/video only under a deliberately reviewed policy. F00 disables them by default; its safe shell tests can be visually inspected with local screenshots. Hosted failure reports have three-day retention, contain synthetic shell cases and must be reviewed before tests expand to private/provider flows.

## Deferred deployment-preparation checklist

The founder explicitly deferred these prerequisites while local frontend/API integration proceeds. Resend is selected for staff email. Open items retain backend owners; they are not closed by a frontend skeleton.

- B12-INT-01/B13-02: configure actual staff identity/OIDC policy, Resend verified domain/sender and server-side credentials; test real inbox delivery and password/code expiry/replay/rate-limit/revocation/recovery.
- B12-INT-01/feature owners: actual provider/analysis permissions and credentials, reviewed limits, recovery policy, coin rewards and template prices; isolated test settings do not establish production values.
- R02/B12-INT-01: final hosting direction, HTTPS/proxy/ingress, frontend/API/staff/OBS origins, private PostgreSQL/Redis networking, constrained runtime grants, per-process secret injection, key rotation/custody and independent journals/frontiers. Respect existing Fly.io direction until a hosting change is approved.
- R02/B12-04/B13-02: named backup/key/restore operators, acceptable downtime and data-loss objectives, hosted backup/PITR/expiration evidence, retention/deletion policy and held-restore proof. Avoid resurrecting revoked proofs or removed content after restore.
- B12-02/B12-05: agree actual pilot traffic and critical-request/backlog/resource limits; measure API/database/worker/SSE/OBS behavior, bounded outages, duplicate/delayed provider events and recovery; name alert responders and incident ownership; produce usable runbooks.
- B12-03f/B12-05: final connected browser/provider/OBS/QR/sandbox acceptance, documented exceptions and explicit pilot/release decision. D02 terms, B03 bot identities and D07/B07-ACT-01 payment-exposure gates remain applicable.

Deferral never authorizes external exposure, live payments, persistent migrations, all-feature enablement, secret purchase/rotation or deployment. Specific local real-provider journeys may need their external prerequisites earlier; record them as pending rather than fabricating a pass.

## CI, team workflow and releases

The checked-in GitHub Actions definition installs exact lockfile dependencies, runs `check`, installs Chromium and runs browser acceptance without backend secrets. Read-only token permissions, job timeout and per-PR concurrency are configured. The repository is local-only: hosted checks, remote settings, required branch protection and reviewers are not established. Configure them once the frontend remote is chosen; CI configuration alone does not enforce a protected branch.

Use focused task branches and small PRs into dev with concrete results and acceptance. Review code ownership/boundary changes carefully. A settled release candidate goes through reviewed dev → main with exact source/lockfile/contract/build identity and required checks. Local hooks are enabled but bypassable; hosted gates remain mandatory. Do not run duplicate hosted workflows on every branch push and PR when one PR gate suffices.

Deployment later must choose a static asset host/container, deep-link fallback, immutable asset caching and non-stale HTML/config delivery; separate public/staff/OBS ingress as required by contracts. Verify TLS, CSP, frame/embedding policy, cookie attributes, CORS/CSRF, referrer handling and route-specific caching on the actual host. Payments/identity use backend verified endpoints; frontend hosting is not another business backend.

Record frontend artifact digest, backend compatibility, source and contract revisions, public config and operator/recovery procedure. Do not promise frontend rollback will undo schema changes or provider effects. A release record is not deployment permission. Provider actions, migrations, sandbox payments and production activation retain their own coordinated scope.
