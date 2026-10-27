# Current frontend state

Checkpoint: 2026-10-27, Europe/Warsaw. Local foundation source: `ffc472d`. Read actual Git state before resuming; documentation follow-ups may be on another local branch. The [tracker](FRONTEND_TASK_TRACKER.md) owns statuses and [PLAN](PLAN.md) owns scope.

## Implemented

The canonical rebuild is `darve-frontend`, a separate local React/TypeScript/Vite repository. It contains the requested layers, typed lint/import boundaries, public environment validation, QueryClient composition, lazy public routing/error pages, shared design tokens/primitives, GSAP/Framer Motion adapters, test tooling, Husky hooks and a GitHub Actions definition. Only `/` and the not-found route exist. The homepage explicitly describes an unconnected foundation. The header uses the original standalone magenta logo and locally hosted Inter.

[F00 evidence](FRONTEND_SKELETON.md) records the successful local gate, browser/visual checks, dependency setup and resolved setup failures. These qualify that foundation snapshot, not future features or deployed operation. The frontend GitHub remote is configured; dev is bootstrapped/protected and implementation PR #1 passed its current-head light hosted gate and merged. Future main rules require full frontend release acceptance before stable use. [FW-02](FW02_GIT_CI_IMPLEMENTATION.md) records source/controls/proof. Main and the first full hosted release acceptance remain unexercised; nothing is deployed.

The [F01-01 reference audit](F01_REFERENCE_AND_COMPONENT_AUDIT.md) now inventories the selected screens, shared components/assets and backend migration gaps with labelled synthetic reference captures. It does not add product routes or API behavior.

[F01-02](F01_DESIGN_SYSTEM_IMPLEMENTATION.md) adds semantic dark/light tokens, actions, labelled fields, panels, content/loading/status states and a native modal dialog. An isolated local component fixture is available through Vite and excluded from production routes/build entries. It exercises presentation only, without account or API actions.

[F01-03 motion acceptance](F01_DESIGN_SYSTEM_IMPLEMENTATION.md#f01-03-motion-patterns) adds live reduced-motion policy, display-only feedback presence, stable-ID list positioning and scoped GSAP cleanup proof. Native dialogs remain immediate. Motion runtimes follow their consuming adapters; the component fixture includes motion examples.

## Not implemented or verified

- Creator shell and feature-specific visual/design acceptance, including the missing staff/coin/template surfaces and actual OBS reference fit, with their owning feature batches.
- F02 packaged backend contracts, real API transport/proxy, sessions/CSRF, authorization/cache isolation and realtime integration.
- Actual creator, guest checkout/private receipt, OBS, staff/support and coins/templates journeys.
- External provider/payment/Resend delivery acceptance or deployment. The shell makes no business API requests and requires no Docker services.

## Confirmed decisions

Use the selected React/Vite stack and preserve F dashboard, M/R OBS and A contribution visual references. The screenshot landing matches the standalone template source; this does not prove the current hosted deployment revision. Start with React local state plus TanStack Query and URL state, without an extra global store. GSAP and Framer Motion have distinct presentation responsibilities.

Use task branches/PRs into dev with light hosted validation; main is reserved for stable release source with full frontend acceptance before merge. Branch identity does not prove deployment. Work locally first. Resend is selected for backend staff email. Hosting, real credentials/senders, custody/retention, workload/monitoring and deployment qualification remain in the [deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md). Specific real journeys still need their prerequisites before they can pass.

## Next action

FW-01 documentation and FW-02 Git/CI engineering/dev integration are complete for their recorded scopes. F01-01 inventory, F01-02 first primitives and F01-03 motion patterns are locally qualified. The next slice is F02-01 current API/authority mapping and exact public contracts before real API integration. F01 screen-specific design/visual gaps remain assigned to their real feature callers. Do not repeat F00 or start every planned feature. Use the [new-chat template](NEW_CHAT_TASK_TEMPLATE.md) to resume with one explicit task/batch. Recheck ports, services, dirty work and sibling backend source/schema before any API test; their earlier state is not guaranteed.
