# Isolated local frontend/API composition

Owners: F02-02 session, F02-03 realtime and F03 creator/terms. [Implementation evidence](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-02-transport-session-and-authority) records the qualified source and checks. [OPERATIONS](OPERATIONS.md) owns environment policy. This composition uses the actual backend with disposable PostgreSQL and Redis; it configures no identity, payment, analysis or email provider.

## Start and stop

Requirements: the pinned sibling backend revision, its installed dependencies, Node/npm matching both repositories, a running Docker Desktop engine and installed Playwright Chromium for acceptance. The tool refuses a different backend HEAD or changed tracked application/package inputs. Existing unrelated backend documentation edits are allowed and preserved. It builds the backend before importing its current compiled API; it does not reuse an unknown old dist.

From `darve-frontend`:

```powershell
npm run api:local -- ../darve-backend
```

The API binds only `http://127.0.0.1:3310`. This command creates two uniquely labelled containers with tmpfs storage, random credentials and random loopback PostgreSQL/Redis ports. It applies migrations only to that freshly created database. It never targets the ordinary `darve-backend` or existing `darve-staging` storage. No Compose project or persistent volume is created. Closing the terminal normally with Ctrl+C stops this API and removes this run's labelled containers. All data is disposable.

The defaults permit exactly `http://127.0.0.1:5173` and `http://127.0.0.1:4175` as frontend Origins. Use `127.0.0.1` consistently; `localhost` is a different Origin. These are separate ports on the same local site, allowing the development HttpOnly SameSite cookie. Requests go directly to the declared API origin through backend CORS; there is no permissive Vite proxy.

To connect a new frontend dev process, set its public environment before starting it:

```powershell
$env:VITE_APP_ENV = 'local'
$env:VITE_PUBLIC_API_ORIGIN = 'http://127.0.0.1:3310'
npm run dev
```

Do not start a second process over an occupied 5173. The existing component preview can stay offline; remove the optional origin and restart the frontend when returning to presentation-only work. Without this origin the product makes no session/API request. With it, the shell displays actual session status and supports logout; F03 adds real provider start, current terms and connections. An empty database correctly reports signed out. Without configured providers or current policy, the corresponding action remains unavailable.

## Reproduce the local acceptance

```powershell
npm run test:api:local -- ../darve-backend
```

This owns API 3310, a temporary Vite process on 4175, Chromium and its own fresh storage. Leave those ports free. It cleans them up in `finally`; the user's 5173 component preview stays available. The session fixture at `/tests/fixtures/session.html` is a development/test entry, excluded from production build entries.

The acceptance uses the actual backend session/profile/logout endpoints, SQL session persistence/revocation, Redis-backed runtime and all current migrations. Its Node-only fixture inserts a synthetic user, identity and session into the disposable database and sets a browser HttpOnly cookie. There is no HTTP fixture-login endpoint, product mock login, provider credential exchange or real Twitch identity verification. Never run this fixture against persistent or hosted storage.

Assertions cover signed-out inspection, persisted session/private profile, incorrect CSRF, confirmed logout/revocation and private draft removal in both creator tabs, expiry, revoked/expired-cookie rejection, guest-cookie separation, foreign Origin denial and empty local/sessionStorage. The separate ordinary Playwright suite uses explicitly synthetic network fixtures for deterministic desktop/mobile and uncertain-logout cases; those cases do not replace this local API proof. Neither suite establishes provider, mail, payment, staff/OBS or hosted cookie acceptance.

## Interruption and custody

Ignored `artifacts.local/f02-02/runtime.json` contains only source/run/container/process/port metadata; `acceptance.json` contains safe check names/results. Neither contains credentials, cookies, CSRF proofs or private URLs. Backend request logs and browser traces/screenshots/video are disabled for this acceptance. Runtime metadata can outlive the stopped run: inspect actual processes and containers before reuse.

If forced termination prevents cleanup, inspect containers with the `darve.frontend.task=f02-02` label and compare their exact `darve.frontend.run` label/IDs with this run's metadata. Stop only the verified owned API/process and those containers. Do not remove the ordinary development/staging groups, use broad prune commands or migrate their databases. Removal of tmpfs containers discards their test data. Credentials remain operator-private in the process/container configuration, never frontend build configuration or committed evidence.

Real hosting, HTTPS origins/cookie attributes, secrets, provider configuration, backups/retention and monitoring remain in the [deferred deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md). This local composition is deliberately disposable and is not a staging deployment or backup procedure.

## F02-03 actual realtime acceptance

```powershell
npm run test:realtime:local -- ../darve-backend
```

Leave 3310 and 4175 free. This reuses the isolated runtime with task identity `f02-03`, enables only the local overlay presentation prefix/250 ms stream poll, and creates a new overlay epoch solely for its freshly migrated disposable database. The default `api:local` and session acceptance keep their F02-02 behavior; they do not silently activate reader grants. No existing database, persistent recovery epoch or provider configuration is reused or changed.

The Node-only synthetic creator fixture uses actual owner endpoints to issue grants and change preferences. The browser bootstraps real HttpOnly reader cookies and consumes actual v1/v2 streams. The operator injects socket loss through the owned HTTP server (no HTTP fault endpoint), verifies hidden content/cursor reconnect and revokes the persisted grant through the owner API. Ten checks cover both protocols, including denial of owner actions from reader authority and no bootstrap loop or storage. Zero provider calls, external identity verification or actual OBS/QR proof is implied.

The source fixture is `/tests/fixtures/realtime.html`; it accepts only non-secret display/grant IDs and an optional explicit protocol-2 query. It issues no grants, provides no bootstrap shortcut and is excluded from production build entries/routes. Without valid IDs it shows a labelled acceptance message. It is a transport probe, not the selected OBS design.

Safe metadata lives under ignored `artifacts.local/f02-03/`; task containers have `darve.frontend.task=f02-03` and the unique `darve.frontend.run` label. Cleanup follows the same ownership checks above, and leaves the user's 5173 preview running. For a forced interruption, inspect this task's labels and recorded exact IDs before stopping anything. [F02-03 implementation](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-03-resource-owned-realtime) owns framing/limits, retry/version/freshness rules, failures and acceptance boundaries.

## F03 actual creator and terms acceptance

```powershell
npm run test:creator:local -- ../darve-backend
```

Leave 3310 and 4175 free. The `f03` run uses the same pinned backend and fresh tmpfs PostgreSQL/Redis, enables a clearly classified development-only policy, and runs the actual application entry with a process-local public API origin. Vite uses `envDir: false`; this probe does not load private environment files or provider credentials. The default `api:local` behavior is unchanged. Its Node-only synthetic creator/session is confined to the disposable database; there is no product or HTTP login shortcut.

The probe verifies all three real unavailable provider starts, exact terms and CSRF rejection, policy-version conflict/reset, actual persisted acceptance/reload, authoritative empty connection pages, guest/forged-return denial, missing policy and SQL logout revocation. To test a policy change it restarts only its owned API with new dependencies and the same disposable data. No fault or policy-replacement HTTP endpoint is exposed. Browser traces/private captures and request logs remain disabled. [F03 evidence](F03_CREATOR_CONNECTION_IMPLEMENTATION.md) separates these nine actual API checks from synthetic browser purpose/connection cases.

Safe records live under ignored `artifacts.local/f03/`; containers carry `darve.frontend.task=f03` plus the unique run label. `finally` stops the owned browser, API, temporary Vite and containers. After interruption, compare exact IDs/run metadata and actual liveness before cleanup. Leave the user's 5173 preview and ordinary Docker groups untouched.

No external provider exchange or verified real identity is claimed. Actual provider testing requires backend configuration, registered callback URLs, an allowed frontend return origin and deliberate account consent. Backend development OAuth validation requires `localhost` origins rather than this fixture's `127.0.0.1` origin; configure matching approved origins/cookies consistently for that separate run. Hosted use requires HTTPS. Do not infer provider configuration from a synthetic start/navigation test, print consent URLs, or enable credentials in frontend build variables. Current reviewed terms, receiving readiness, OBS and per-collection permissions retain their respective owners.
