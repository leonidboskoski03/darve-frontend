# Current frontend state

Checkpoint: 2026-10-29, Europe/Warsaw. F03 provider verification and F04-01 mapping are integrated on dev `0318e07`; F04-02 collection controls branch from it. Read actual Git/PR state before resuming; the F04 owner records qualification and integration custody. The [tracker](FRONTEND_TASK_TRACKER.md) owns statuses and [PLAN](PLAN.md) owns scope.

## Implemented

The canonical rebuild is `darve-frontend`, a separate local React/TypeScript/Vite repository. It contains the requested layers, typed lint/import boundaries, public environment validation, QueryClient composition, lazy routing/error pages, shared design tokens/primitives, GSAP/Framer Motion adapters, test tooling, Husky hooks and GitHub Actions. Routes include `/`, `/authorize`, `/integrations`, `/terms`, `/collection`, `/collection/:roundId` and not-found. The homepage rebuilds the selected standalone landing. The header uses the original standalone magenta logo and locally hosted Inter.

[F00 evidence](FRONTEND_SKELETON.md) records the successful local gate, browser/visual checks, dependency setup and resolved setup failures. These qualify that foundation snapshot, not future features or deployed operation. The frontend GitHub remote is configured; dev is bootstrapped/protected and implementation PR #1 passed its current-head light hosted gate and merged. Future main rules require full frontend release acceptance before stable use. [FW-02](FW02_GIT_CI_IMPLEMENTATION.md) records source/controls/proof. Main and the first full hosted release acceptance remain unexercised; nothing is deployed.

The [F01-01 reference audit](F01_REFERENCE_AND_COMPONENT_AUDIT.md) now inventories the selected screens, shared components/assets and backend migration gaps with labelled synthetic reference captures. It does not add product routes or API behavior.

[F01-02](F01_DESIGN_SYSTEM_IMPLEMENTATION.md) adds semantic dark/light tokens, actions, labelled fields, panels, content/loading/status states and a native modal dialog. An isolated local component fixture is available through Vite and excluded from production routes/build entries. It exercises presentation only, without account or API actions.

[F01-03 motion acceptance](F01_DESIGN_SYSTEM_IMPLEMENTATION.md#f01-03-motion-patterns) adds live reduced-motion policy, display-only feedback presence, stable-ID list positioning and scoped GSAP cleanup proof. Native dialogs remain immediate. Motion runtimes follow their consuming adapters; the component fixture includes motion examples.

[F02-01](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md) supplies the exact backend public-contract artifact, narrow import facade and [source/authority operation map](FRONTEND_API_CONTRACT_MATRIX.md). It exposes five concrete wire/helper gaps for subsequent feature work. At the F02-01 checkpoint a local component preview was available on port 5173; F03 subsequently replaces the public homepage.

[F02-02](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-02-transport-session-and-authority) adds origin-bound validated Fetch, explicit pending/empty responses, safe errors, creator session/CSRF/expiry/logout and authority-scoped query/cache/draft cleanup. An optional public API origin enables actual session status; the default remains offline. [Disposable local API composition](LOCAL_API_COMPOSITION.md) passed real session/profile/CSRF/revocation/expiry/isolation checks with PostgreSQL, Redis and 60 fresh migrations. The fixture identity is synthetic; real provider login remains F03. GAP-202 is addressed in the client; the pinned helper and four feature-specific gaps remain unchanged.

[F02-03](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-03-resource-owned-realtime) supplies resource-owned overlay v1/v2 Fetch/SSE framing, same-connection resync reads, cursor reconnects, strict version/time floors, monotonic freshness and authority/reader cleanup. Ten actual disposable browser/API checks passed for both protocols, including SQL preference changes, actual socket interruption and persisted grant revocation. GAP-OVERLAY-V2 is addressed in the frontend adapter with full template metadata retained; the packaged reducer remains v1. No dashboard SSE, support-schema completion, OBS renderer or product route is implied. The default homepage stays offline.

[F03](F03_CREATOR_CONNECTION_IMPLEMENTATION.md) implements the standalone landing and actual three-provider creator entry, current server terms/version/hash acceptance, connection pagination, separate identity/chat/DarveBot purposes and version-confirmed unlink. Callback hints never establish authority. Missing API/provider/policy configuration is explicit. Nine actual disposable API checks, the full local gate (117 unit/component cases) and all 48 desktop/mobile browser cases passed; a subsequent founder-assisted run passed nine actual registered-app OAuth operations, all-provider fresh sign-in, authenticated linking, streaming-purpose consent and separate Twitch bot-destination consent. Final SQL state was zero active/three revoked sessions. Development terms only; live collector/bot/payment readiness and production activation remain separate. The existing 5173 preview now serves this public landing.

[F04](F04_COLLECTION_IMPLEMENTATION.md) compares standalone and the selected F creator workflow. F04-02 implements its responsive workspace, all-provider owned-source selection, Start, durable known-ID round reads/countdown, version-confirmed Stop/cancel and uncertainty/authority cleanup. Eleven disposable actual API checks use controlled provider/funding/capacity facts around the actual backend and SQL; synthetic browser captures remain labelled. Actual live ingestion/analysis/receiving is unverified. Unknown active-round recovery and original source-link projection remain open; suggestion review/acceptance is F04-03.

## Not implemented or verified

- Remaining feature-specific visual/design acceptance, including review/acceptance, missing staff/coin/template surfaces and actual OBS reference fit, with their owning feature batches. The F04-02 collection workspace has local responsive/accessibility evidence.
- Mapped staff/support/moderation public-contract gaps; full guest/reader/staff feature authority lifecycles and joint acceptance remain with their feature owners.
- Actual connected collection/analysis/receiving/OBS and guest checkout/private receipt, staff/support and coins/templates journeys. Registered-development-app creator OAuth/consent now has actual evidence.
- External provider/payment/Resend delivery acceptance or deployment. The default shell requires no Docker; configured session inspection and isolated API acceptance are now available.

## Confirmed decisions

Use the selected React/Vite stack and preserve F dashboard, M/R OBS and A contribution visual references. The screenshot landing matches the standalone template source; this does not prove the current hosted deployment revision. Start with React local state plus TanStack Query and URL state, without an extra global store. GSAP and Framer Motion have distinct presentation responsibilities.

Use task branches/PRs into dev with light hosted validation; main is reserved for stable release source with full frontend acceptance before merge. Branch identity does not prove deployment. Work locally first. Resend is selected for backend staff email. Hosting, real credentials/senders, custody/retention, workload/monitoring and deployment qualification remain in the [deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md). Specific real journeys still need their prerequisites before they can pass.

## Next action

Next product work is F04-03 safe suggestion review and exact challenge acceptance, after the F04-02 final gate and protected dev integration recorded in its owner. Preserve F04-G01 unknown-round recovery, F04-G03 source-link projection and actual receiving/reader/analysis prerequisites. Earlier foundation, design/motion, transport/realtime and creator identity scopes retain their own evidence; do not repeat them or start every planned feature. Use the [new-chat template](NEW_CHAT_TASK_TEMPLATE.md) to resume one explicit task. Recheck ports, services, dirty work and sibling backend source/schema before API tests; earlier liveness is not guaranteed.
