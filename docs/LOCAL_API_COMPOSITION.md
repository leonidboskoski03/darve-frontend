# Isolated local frontend/API composition

Owners: F02-02 session, F02-03 realtime and F03 creator/terms. [Implementation evidence](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-02-transport-session-and-authority) records the qualified source and checks. [OPERATIONS](OPERATIONS.md) owns environment policy. The default composition uses the actual backend with disposable PostgreSQL and Redis; it configures no identity, payment, analysis or email provider. The separately approved operator mode below explicitly enables registered identity providers only.

For ordinary connected development use the [persistent creator workspace](OPERATIONS.md#connected-local-creator-workspace). This document covers disposable acceptance profiles.

## Start and stop

Current acceptance uses the exact contract source in `vendor/contracts/provenance.json` and the retained clean checkout `../tmp/backend-f06-checkout`. Its current F09-06/F10 pin is `32d8716bf93fef695a4fef4fcb51a9fa2a59fdcf`; the historical F09-02 pin was `8103c8607e475e711c8b8fc5f5e3eceb1d0e65fc`. Historical source paths/checkpoints below are not overrides: a different HEAD or changed/untracked backend build input fails closed. The original dirty checkout and ordinary data remain untouched.

F06-03 checkout qualification: `npm.cmd run test:checkout:local -- ../tmp/backend-f06-readiness`. Run sequentially with 3310/4175 free. The exact `f06-03` task requires `collection/review/checkout`, rejects operator credentials and incompatible read/reporting fixtures before runtime access, and creates fresh tmpfs storage. Actual HTTP/domain/SQL create/resume/capture run against Node-only synthetic provider/receiving ports. Thirteen actual checks pass, including actual receiving overlap and safe completion before PayPal approval; this is controlled engineering evidence, separate from the actual F06-04 provider acceptance. `finally` cleans the owned services/containers. [F06](F06_CONTRIBUTION_IMPLEMENTATION.md#f06-03-checkout-implementation) owns details and failures.

The separately approved F06-04 sandbox runner is `node --use-system-ca tools/payment-sandbox.mjs <stripe|paypal> F06-04 ../tmp/backend-f06-readiness ../darve-backend`. It requires exact task/port/origin/provider/approval before reading configuration or accessing Docker; it cannot combine with OAuth operator or synthetic checkout/reporting fixtures. It reads only the selected ignored sandbox configuration into RAM, injects actual receiving/payment services and a separately bounded test composition, and caps one reviewed EUR10/Stripe or USD10/PayPal contribution with a synthetic 0.70 fee. Ordinary environment/payment composition stays closed. Stripe continues its original verified account; PayPal permits consent to the existing seller only, without new account creation. The user completes the actual browser/provider flow. Never invoke this runner merely because ordinary/local tests passed. See [the owner](F06_CONTRIBUTION_IMPLEMENTATION.md#f06-04-bounded-sandbox-acceptance) for current approval, limits and evidence.

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

`collection: true` is accepted only for explicit tasks `f04-02`, `f04-03` and `f05`; it cannot combine with real-provider operator credentials. No `.env`, real provider/receiving/analysis credentials, collector process, bot posting, pin action or external provider call is used. Ordinary session/realtime/creator fixtures retain providers OFF. Safe aggregate evidence is ignored `artifacts.local/f04-02/acceptance.json`; it explicitly records controlled ports, actual lifecycle recovery and no verified live collection. These checks do not qualify live ingestion, AI analysis, funding or OBS.

The deterministic collection/review browser suite uses explicitly labelled synthetic API fixture entries and produces only synthetic captures when `F04_CAPTURE_DIR` is set. Product build entries exclude all test fixtures. `test:e2e` builds five separate acceptance HTML entries into ignored `dist-acceptance/` and serves their static output on 4175, beside the regular product preview on 4173. This avoids depending on development-module serving for deterministic browser qualification. API/operator runners still use isolated Vite modes and `envDir: false`. Modes isolate caches; they never establish authentication or provider readiness. The default product requires a configured API, actual creator session and current terms before collection controls are available.

## F04-03 controlled review and acceptance

```powershell
npm.cmd run test:review:local -- ../darve-backend
```

Run sequentially with other probes and leave 3310/4175 free. This probe requires explicit task `f04-03`, `collection: true`, `review: true` and disposable tmpfs storage. The F05 composition also permits review for its prerequisite challenges. Guards reject enabling review for other tasks or combining it with operator credentials. The additional commercial policy, provider observations, receiving/capacity and model ports are synthetic Node-only configuration. The normal composition and F04-02 probe retain their previous settings.

The actual application performs session/current terms, source selection, Start, status, Stop, review, pin, exact confirmation and challenge reads. The Node-only harness writes synthetic Twitch messages through the actual ingestion store, admits them into the actual collecting round and runs the real freeze/analysis repositories and processing service with deterministic model observations. It provisions a fresh controlled source/reader for the later-round coexistence case. Thirteen checks include full credits/membership, CSRF/stale/foreign-owner denial, exact creation, replay/conflicting terms, reload without rejection, receiving denial, coexisting challenges, restriction hiding and logout revocation.

No application HTTP response is mocked in this run. Actual external ingestion, model accuracy, receiving, checkout/payment, bot/pin or OBS is not established. Safe aggregate evidence is ignored `artifacts.local/f04-03/acceptance.json`; no private cookies, CSRF, operation keys, provider payloads or real identity screenshots are saved. `finally` closes owned browser/Vite/API/containers. After interruption inspect exact task/run labels and runtime IDs before removal; preserve the user's 5173 preview and ordinary backend on 3000 with its persistent storage. [F04-03](F04_COLLECTION_IMPLEMENTATION.md#f04-03-suggestion-review-and-challenge-acceptance) owns qualification, resolved issues and remaining pre-acceptance policy/disclosure gaps.

## F05 controlled reporting and declaration acceptance

```powershell
npm.cmd run test:reporting:local -- ../darve-backend
```

Run sequentially, leaving 3310/4175 free. This uses task `f05` with explicit `collection`, `review` and `reporting` enabled. Invalid combinations fail before backend/Docker access. Real operator credentials cannot combine with this composition. Fresh tmpfs PostgreSQL/Redis receive the pinned 60 migrations; only this run's API, Vite and browser are owned. `finally` cleans them up. The ordinary 3000 API/storage and offline 5173 frontend remain separate. After interruption inspect exact `darve.frontend.task=f05` and run labels/recorded IDs before cleaning temporary resources.

Sixteen actual browser/API/SQL checks cover empty reporting, the 23-hour Europe/Warsaw civil day, multiple/expired challenge history, owner cursors and foreign-resource denial, separate exact EUR/USD totals, known-round analytics, unfunded/CSRF/changed-stream denial, confirmed completion, same-key replay, reload, restriction and logout. No application HTTP response is mocked. Node-only controlled identity/provider/model/commercial/receiving evidence prepares accepted challenges through actual ingestion/freeze/analysis/domain code. Synthetic trusted success facts pass through actual financial repositories in disposable storage; they do not prove an external charge, signed webhook, guest checkout or live stream. The owner/platform recipient is reused across currencies, preserving the backend's one-active-recipient rule.

Safe aggregate checks are in ignored `artifacts.local/f05/acceptance.json`; request logs, private captures/traces and credential persistence remain disabled. [F05](F05_DASHBOARD_IMPLEMENTATION.md) owns source, failures, visual qualification and integration evidence. The static browser suite has separate explicitly labelled synthetic fixtures/captures; neither substitutes for external receiving/payment or final owner/guest/OBS acceptance.

## F06 public challenge and private receipt read acceptance

```powershell
npm.cmd run test:contribution:local -- ../darve-backend
```

Run sequentially with 3310/4175 free. Task `f06` requires explicit `collection`, `review` and `contributionReads` before runtime access. The Node-only seam seeds existing receipt facts through actual financial repositories in fresh tmpfs PostgreSQL/Redis (60 migrations). It composes the actual checkout dispatcher/service/controller with creation explicitly false, no external provider I/O and a non-paying controlled retrieval port. Both injected and ordinary creation remain disabled. No real provider credentials, production payment flag or HTTP fixture login/control endpoint exists.

Thirteen actual browser/API/SQL checks cover public credentials omission, creator/guest separation, ordinary creation denial with zero extra attempts, original-cookie reload, provider-return cleanup, unknown/failed attempts, verified eligible/late/unclassified timing, restricted public source with retained private financial history, revoked/expired guest access and GET-only/no-storage browser behavior. Synthetic receiving/model/financial evidence does not qualify Stripe/PayPal external payment or webhook verification. The separately built fifth static contribution fixture produces only labelled synthetic presentation evidence when `F06_CAPTURE_DIR` is set; it is excluded from product entries.

Ignored `artifacts.local/f06/acceptance.json` contains only safe aggregate names/results. No private screenshots, traces, request payloads, cookies or proofs are saved. `finally` closes this run's browser/Vite/API/labelled containers. After interruption compare exact IDs with `darve.frontend.task=f06` and its run label before cleanup. Preserve ordinary API/storage and any separately owned preview. [F06](F06_CONTRIBUTION_IMPLEMENTATION.md) owns final qualification and the existing B07-ACT-01/availability prerequisites; this run does not activate checkout.

## F09-02 coin read acceptance

Run `npm.cmd run test:coins:local` with 3310/4175 free. The exact provider-free `coins: true`/`f09-02` composition creates only disposable labelled storage and a temporary independent journal directory; it uses separate constrained public/admin/worker roles. The production-compiled isolated fixture verifies six creator read adapters and their authority/error boundaries against the actual API/SQL. It supplies synthetic configuration and controlled SQL consumer readiness, never a worker loop or browser earning/spending command.

The real journal's directory-sync readiness is false on Windows and remains recorded as false. F09-G01 requires Linux-backed journal append/seal/recovery before actual earning/redemption acceptance. Do not use this read fixture's synthetic readiness as proof of durable accounting or ordinary activation. [F09-02](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-02-contract-and-read-foundation) owns exact qualification, failures, limitations and cleanup; `artifacts.local/f09-02/` holds safe read evidence.

## F09-G01 Linux journal and worker

Run `npm.cmd run test:coins:journal` against the clean pinned backend, with Docker and its `node:24.16.0-bookworm-slim` base image available and 3310 free. Exact `f09-g01` composition adds a separate owned Linux journal volume/container to the disposable SQL/Redis fixture; the real backend journal receives keys through stdin and has no network or SQL credentials. The real worker verifies durable append before SQL seal.

Six actual checks qualify pending-credit handling, lost acknowledgement and actual container restart, once-only 20-credit/5-debit replay, stopped-journal denial, wrong-key/binding denial and byte-tamper rejection. These use synthetic audited adjustments; mission earning/redemption remain feature acceptance. [G01](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-g01-linux-durable-journal-acceptance) owns exact source/image/bundle identities, cleanup and remaining limits. Existing F09-02 read mode keeps its Windows journal result and denies G01-only owner-session setup. Ordinary settings and services remain untouched.

## F09-03 creator coins and canonical earning

Run `npm.cmd run test:coins:creator` against the retained pinned backend, with Docker/base Node image available and 3310/4175 free. Exact `f09-03` adds controlled collection/review and synthetic development terms to coins/Linux-journal composition. The private setup helper uses actual session/CSRF validation, collection lifecycle, admitted ingestion, snapshot and analysis publication; it never inserts coin facts directly. Twelve controlled messages yield eleven qualifying viewer/idea units and two mission awards.

Eight actual production-browser/API/SQL/journal scenarios verify pending versus available rewards, same-record acknowledgement retry, two-row paging, real 30-second cursor expiry, recovery, owner isolation, session expiry and logout. Browser mocks separately test feature-off/unavailable/large values and responsive states. The public role's extra terms-table grants exist only in the fresh fixture; ordinary grants/configuration remain unchanged. [F09-03](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-03-creator-coins) owns source/qualification and synthetic capture limits. Finalizers verify run labels and remove only owned runtimes.

## F09-04 template redemption

Run `npm.cmd run test:templates:local` against the clean pinned backend, leaving 3310/4175 free. Exact `f09-04` permits coins/Linux journal only; it rejects collection, terms, providers, payments, staff/support and overlay composition before runtime access. Task/run-owned Node controls install synthetic manifests/prices through the private migration-owner asset port and real staff price service. An actual audited disposable credit supplies test coins. There is no product fixture endpoint, commercial asset or ordinary configuration change.

The production-browser/API/SQL/Linux-journal run checks stale prices, competing reviews, once-only debit/entitlement, committed lost HTTP responses, same-key replay, journal interruption/restart/sealing, insufficient balance, permanent ownership across versions/withdrawal/reload, exact history, mobile accessibility and authority isolation. Product rendering/selection/OBS proof remains F09-05. [F09-04](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-04-template-catalogue-and-reviewed-redemption) owns observed qualification and current source custody. The existing label-verified finalizer removes only this run's runtime resources; ordinary 3000/5432/6379 and 5173 remain separate.

## F09-05 template selection and OBS

`node tools/local-template-obs-acceptance.mjs ../tmp/backend-f06-checkout` requires exact `f09-05`: coins, controlled collection/review/development terms, overlay and Linux journal on 3310/4175. Payment/provider/support/reporting mixtures are rejected. Setup uses actual canonical collection/analysis/acceptance with controlled provider/model/receiving ports, installs the reviewed compact manifest and a synthetic price, then verifies earning, redemption, selection and actual SSE. The disposable public role adds explicit overlay/source/funding projection capabilities only; no direct coin-table, blanket or default privileges are granted. These are fixture grants, not production R02 qualification.

The regular configured product build exercises independent revisions, committed lost-selection response, stale selection, layout preservation, legacy denial, QR decoding, reader reload/revocation, withdrawal and unsupported future version hiding. `--observe` adds a 15-minute loopback-only operator page at `/__f09_observation`, retaining the private grant in memory and requiring separate actual OBS observation. It creates no HTTP fixture mutation endpoint. Keep private values out of chat, files, logs and screenshots. Only explicit reported observation is recorded as actual OBS proof; browser output alone is not. [F09-05](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-05-approved-card-selection-and-obs) owns source/hash/approval custody, failures, observation limits and cleanup. Successful/failing finalizers remove only matching task/run resources.

## F09-06 staff coin tools

`npm.cmd run test:staff-coins:local` requires exact `f09-06`: coins, support and the constrained Linux journal, with no collection/terms/overlay/payment/provider execution. It uses fresh labelled PostgreSQL/Redis on dynamic ports, public API 3310, independent staff API `localhost:3320` and the regular staff product build at `localhost:4176`. Shared B13 roles are installed once by support; B15 adds its explicit functions/worker role. Both fixtures reuse the same synthetic staff authority rather than trying a second Owner bootstrap. No ordinary database or grants are changed.

Node-only setup creates a disposable program, synthetic rewards/initial credit and a synthetic manifest through the existing services. Actual browser writes exercise staff origin/CSRF/confirmation/revision/reauthentication/idempotency and audits; the independent journal seals adjustments. Actual ticket assignment changes test read-only coin context and removal after reassignment. No setup command is exposed through HTTP. The named [F09-06 record](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-06-owner-coin-tools-and-assigned-support-context) owns proof and remaining checks. Source fingerprints and sanitized evidence live under ignored `artifacts.local/f09-06/`; finalizers close only owned browser/servers/clients and matching task/run-labelled containers and journal volume.

## F09-07 combined coin/template acceptance

`npm.cmd run test:coins:combined` requires exact `f09-07`: coins/support/collection/review/terms/overlay together, with no payment, reporting, provider OAuth or external QR origin. It reuses the same task-bound support authority, explicit fixture roles and Linux journal, with fresh labelled storage. Product creator/OBS and staff builds run on 4175/4176, public/staff APIs on 3310/3320; ordinary services remain separate. No initial credit or reward configuration is seeded. Owner product controls configure synthetic rewards/prices, then real controlled collection earning funds one real template redemption and a separately reviewed adjustment.

The combined run checks once-only journal recovery and lost-response retry, price/revision races, verified ownership/selection/SSE, fresh private reader and exact QR, assigned Support context/reassignment, withdrawal/fallback and unavailable/read-recovery/revocation. It compares unchanged OBS boundary sources with the earlier native baseline; it does not automate OBS or claim another physical scan. Full Git history containing the recorded native candidate, the pinned built backend, Docker and free task ports are required. Source/counter/native-proof inheritance and cleanup custody live in ignored `artifacts.local/f09-07/` and the [owning record](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-07-combined-local-acceptance-and-handoff). Finalizers remove only the matching run's resources.

## F10-02 connected creator lifecycle

Run `npm.cmd run test:lifecycle:local` with the current clean pinned backend, Docker and free loopback ports 3310/4175. The exact `f10-02` task requires collection, review, reporting and development terms. Before any source/configuration/Docker access it rejects changed ports/origins, omitted capabilities and checkout, sandbox, OAuth, public QR, OBS, staff or coin extensions. Existing task guards are retained; this is not a general all-feature composition.

The runner builds the regular production entry into its own ignored output and uses fresh labelled tmpfs PostgreSQL/Redis with the actual current migrations. Its Node-only creator cookie, discovery/receiving observations, analysis models and explicit financial prerequisites are synthetic. Twitch storage, YouTube batch/cursor storage and locally signed Kick ingress/consumption feed actual collection admission and analysis repositories. No provider/network credential is loaded and no product fixture login/control endpoint is added.

Actual UI/API/storage assertions connect collection/known-round refresh/Stop, grouped review/credits, exact versioned acceptance, retained history/dashboard/round analytics and declaration preconditions. Lost-response probes execute the original API request before dropping only its response, then require the same held key/body. They do not mock internal response data. Synthetic financial facts qualify declaration engineering only; F10-03 retains genuine checkout/payment/funding acceptance. F04-G01/G03 remain open contracts. Safe fingerprints, failed-run history and cleanup are in `artifacts.local/f10-02/`; finalizers close only owned browser/preview/API/clients and matching task/run containers. See [F10-02](F10_JOINT_ACCEPTANCE_IMPLEMENTATION.md#f10-02-connected-local-creator-lifecycle).

## F10-04 connected staff and rewards lifecycle

Run `npm.cmd run test:staff-lifecycle:local` with Docker, the current pinned backend and free 3310/3320/4175/4176 loopback ports. The `--lifecycle` option extends the F09 combined runner through an exact, separately validated `f10-04` composition for collection, review, development terms, controlled checkout, OBS, support, coins and a Linux journal. It rejects external OAuth/payment credentials, relays, direct reporting-funding fixtures and partial capability sets before source or Docker access. The original F09 command retains its narrower composition.

Both regular production browser builds share one disposable canonical creator/round/challenge. Node-only controlled discovery, model, receiving, payment and staff identity ports supply external facts. Actual services, SQL triggers, HTTP contracts and journal recovery determine results. Product browser controls start/stop/review/accept, configure prospective test rewards, redeem/select, attach support context, review recovery and declare completion. Fresh guest receipt reads distinguish verified money from eligible timing before the funding reward. No fact, coin claim or financial payment is inserted directly by this runner.

The disposable public role receives explicit lifecycle table/view capabilities in addition to its existing projection functions. Public/admin/worker coin roles retain their restricted coin-function boundaries and no direct coin-table access. These fixture grants do not qualify ordinary R02 provisioning or B15-03-G01. Safe capability-name diagnostics omit SQL statements and arguments. Matching task/run labels guard journal, storage and container cleanup. The ignored `artifacts.local/f10-04/` directory stores fingerprints, sanitized failures and final proof. The qualification record tracks the external requirements. [F10-04](F10_JOINT_ACCEPTANCE_IMPLEMENTATION.md#f10-04-connected-staff-support-and-rewards)
