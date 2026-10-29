# Isolated local frontend/API composition

Owners: F02-02 session, F02-03 realtime and F03 creator/terms. [Implementation evidence](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-02-transport-session-and-authority) records the qualified source and checks. [OPERATIONS](OPERATIONS.md) owns environment policy. The default composition uses the actual backend with disposable PostgreSQL and Redis; it configures no identity, payment, analysis or email provider. The separately approved operator mode below explicitly enables registered identity providers only.

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

## Explicit real-provider operator run

F03-AC-01 now has separate founder-approved actual provider evidence in the [F03 record](F03_CREATOR_CONNECTION_IMPLEMENTATION.md#f03-ac-01-registered-app-verification--2026-10-29). Its tooling is opt-in; ordinary session/realtime/creator acceptance continues with providers OFF.

```powershell
npm run test:operator
npm run provider:local -- ../darve-backend --pause-development-api
```

Use the pause flag only when deliberately testing against the known registered localhost callbacks and the existing `darve-backend-api-1` needs to release port 3000. It records and pauses that exact running API container and restores the same ID on cleanup. It never pauses/reuses its database or Redis, migrates persistent storage, alters registration or starts the ordinary Compose group wholesale. Without the flag, free 3000 yourself or omit it if already free. Leave 5174 free. The offline 5173 preview remains separate.

The runner privately selects only the six Twitch/Google/Kick client fields from the sibling `.env`, uses a fresh encryption key and creates new task-labelled tmpfs storage. It does not inherit that file's database URL, Redis URL, old credential key, bot actors, feature flags, payment/analysis configuration or terms policy. A clearly classified development-only document exercises version acceptance without inventing public legal terms. Only the public API origin is passed to Vite; `envDir: false` prevents frontend env-file loading. Node uses the system CA with TLS verification enabled.

Open `http://localhost:5174/authorize` in the testing browser. The actual app makes the normal POST start; the backend owns redirect construction and code exchange at `http://localhost:3000/api/auth/:provider/callback`. No synthetic user/session is inserted and no HTTP login/control endpoint is supplied. The user completes any required credential/MFA/challenge and new account-data consent on the provider screen. Registered app access, scope consent, a Darve session, development terms and actual reader/bot/payment readiness remain different facts. Do not save cookies, consent URLs, provider payloads or private browser traces.

After the desired flows, use the fixed read-only audit while this run is still alive:

```powershell
npm run provider:audit
npm run provider:local -- --stop
```

The audit verifies the recorded PostgreSQL container's exact task/run labels and prints aggregate provider/intent/purpose completion, connection count, one-owner binding, AES-GCM envelope count and active/revoked session counts. It does not select subject/channel IDs, tokens or envelope values. Safe metadata/audit lives under ignored `artifacts.local/f03-live/`. The stop command writes a local request bound to the exact current run; a stale request cannot stop a replacement. Wait for the running operator to exit, verify 5174/API listener ownership, no remaining F03-live containers and ordinary API restoration. Command submission alone is not cleanup proof.

Prefer the explicit stop command in Windows tool sessions: Ctrl+C can terminate the process tree before Node cleanup runs. On forced termination, compare the exact IDs/run labels in `runtime.json` and original API ID in `restore.json`; remove only those disposable containers and restart only the matching original API if it was paused. Never prune or delete ordinary storage. The explicit-stop path has actual startup/cleanup/restoration proof. Session logout does not revoke the provider's application consent; those account settings remain under the user's control.

## F04-02 controlled collection acceptance

```powershell
npm.cmd run test:collection:local -- ../darve-backend
```

Leave 3310 and 4175 free and run probes sequentially. This task owns API 3310, temporary Vite 4175, Chromium and exact task/run-labelled tmpfs PostgreSQL/Redis containers. It applies the pinned backend's 60 migrations to fresh storage. The ordinary API on 3000, its persistent storage and the user's offline 5173 preview stay separate. `finally` closes owned resources; after interruption inspect exact IDs/run metadata and liveness before cleanup. Never use broad prune or ordinary database migration commands.

This is a controlled fixture around actual API/controller/domain/repositories/SQL. Node-only inputs supply synthetic identities/session, encrypted grant facts, provider observations, capacity and receiving-readiness ports. No HTTP login/control endpoint or mocked application HTTP response is added. Start genuinely writes preparation; the runner explicitly invokes the pinned worker lifecycle recovery code to activate its controlled healthy reader, then verifies reload, Stop and one frozen empty snapshot. It also checks all-provider preparation/cancel, CSRF, another owner's denial, same-key operation identity, receiving-readiness denial and logout revocation. [F04 evidence](F04_COLLECTION_IMPLEMENTATION.md#qualified-behavior-and-limits) owns the exact qualification and limits.

`collection: true` is accepted only for explicit task `f04-02`; it cannot combine with real-provider operator credentials. No `.env`, real provider/receiving/analysis credentials, collector process, bot posting, pin action or external provider call is used. Ordinary session/realtime/creator fixtures retain providers OFF. Safe aggregate evidence is ignored `artifacts.local/f04-02/acceptance.json`; it explicitly records controlled ports, actual lifecycle recovery and no verified live collection. These checks do not qualify live ingestion, AI analysis, funding or OBS.

The deterministic collection browser suite uses an explicitly labelled synthetic API fixture entry and produces only synthetic captures when `F04_CAPTURE_DIR` is set. That entry is excluded from production routes/build entries. Vite optimization caches are separated by mode: normal development, browser acceptance and each local API/operator runner. `envDir: false` remains in API/operator runners. Modes isolate caches; they never establish authentication or provider readiness. The default product requires a configured API, actual creator session and current terms before collection controls are available.
