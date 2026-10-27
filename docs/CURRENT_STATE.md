# Current frontend state

Checkpoint: 2026-10-27, Europe/Warsaw. Local foundation source: `ffc472d`. Read actual Git state before resuming; documentation follow-ups may be on another local branch. The [tracker](FRONTEND_TASK_TRACKER.md) owns statuses and [PLAN](PLAN.md) owns scope.

## Implemented

The canonical rebuild is `darve-frontend`, a separate local React/TypeScript/Vite repository. It contains the requested layers, typed lint/import boundaries, public environment validation, QueryClient composition, lazy public routing/error pages, shared design tokens/primitives, GSAP/Framer Motion adapters, test tooling, Husky hooks and a GitHub Actions definition. Only `/` and the not-found route exist. The homepage explicitly describes an unconnected foundation. The header uses the original standalone magenta logo and locally hosted Inter.

[F00 evidence](FRONTEND_SKELETON.md) records the successful local gate, browser/visual checks, dependency setup and resolved setup failures. These qualify that foundation snapshot, not future features or deployed operation. The frontend GitHub remote is configured; dev is bootstrapped/protected and implementation PR #1 passed its current-head light hosted gate and merged. Future main rules require full frontend release acceptance before stable use. [FW-02](FW02_GIT_CI_IMPLEMENTATION.md) records source/controls/proof. Main and the first full hosted release acceptance remain unexercised; nothing is deployed.

The [F01-01 reference audit](F01_REFERENCE_AND_COMPONENT_AUDIT.md) now inventories the selected screens, shared components/assets and backend migration gaps with labelled synthetic reference captures. It does not add product routes or API behavior.

[F01-02](F01_DESIGN_SYSTEM_IMPLEMENTATION.md) adds semantic dark/light tokens, actions, labelled fields, panels, content/loading/status states and a native modal dialog. An isolated local component fixture is available through Vite and excluded from production routes/build entries. It exercises presentation only, without account or API actions.

[F01-03 motion acceptance](F01_DESIGN_SYSTEM_IMPLEMENTATION.md#f01-03-motion-patterns) adds live reduced-motion policy, display-only feedback presence, stable-ID list positioning and scoped GSAP cleanup proof. Native dialogs remain immediate. Motion runtimes follow their consuming adapters; the component fixture includes motion examples.

[F02-01](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md) supplies the exact backend public-contract artifact, narrow import facade and [source/authority operation map](FRONTEND_API_CONTRACT_MATRIX.md). It exposes five concrete wire/helper gaps for subsequent feature work. The local component preview on port 5173 was started for the user; it remains an unconnected fixture.

[F02-02](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-02-transport-session-and-authority) adds origin-bound validated Fetch, explicit pending/empty responses, safe errors, creator session/CSRF/expiry/logout and authority-scoped query/cache/draft cleanup. An optional public API origin enables actual session status; the default remains offline. [Disposable local API composition](LOCAL_API_COMPOSITION.md) passed real session/profile/CSRF/revocation/expiry/isolation checks with PostgreSQL, Redis and 60 fresh migrations. The fixture identity is synthetic; real provider login remains F03. GAP-202 is addressed in the client; the pinned helper and four feature-specific gaps remain unchanged.

## Not implemented or verified

- Creator shell and feature-specific visual/design acceptance, including the missing staff/coin/template surfaces and actual OBS reference fit, with their owning feature batches.
- F02-03 realtime integration and mapped feature-specific contract gaps; complete guest/reader/staff authority lifecycles remain with their feature owners.
- Actual creator, guest checkout/private receipt, OBS, staff/support and coins/templates journeys.
- External provider/payment/Resend delivery acceptance or deployment. The default shell requires no Docker; configured session inspection and isolated API acceptance are now available.

## Confirmed decisions

Use the selected React/Vite stack and preserve F dashboard, M/R OBS and A contribution visual references. The screenshot landing matches the standalone template source; this does not prove the current hosted deployment revision. Start with React local state plus TanStack Query and URL state, without an extra global store. GSAP and Framer Motion have distinct presentation responsibilities.

Use task branches/PRs into dev with light hosted validation; main is reserved for stable release source with full frontend acceptance before merge. Branch identity does not prove deployment. Work locally first. Resend is selected for backend staff email. Hosting, real credentials/senders, custody/retention, workload/monitoring and deployment qualification remain in the [deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md). Specific real journeys still need their prerequisites before they can pass.

## Next action

FW-01 documentation and FW-02 Git/CI engineering/dev integration are complete for their recorded scopes. F01-01 inventory, F01-02 first primitives and F01-03 motion patterns are locally qualified. F02-01 mapping/artifact and F02-02 transport/session/isolation are qualified for their recorded scopes. Next is F02-03 resource/version/freshness-aware realtime, before actual creator connection/onboarding in F03. F01 screen-specific design/visual gaps remain assigned to their real feature callers. Do not repeat F00 or start every planned feature. Use the [new-chat template](NEW_CHAT_TASK_TEMPLATE.md) to resume with one explicit task/batch. Recheck ports, services, dirty work and sibling backend source/schema before any API test; their earlier state is not guaranteed.
