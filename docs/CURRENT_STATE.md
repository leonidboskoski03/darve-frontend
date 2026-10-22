# Current frontend state

Checkpoint: 2026-10-22, Europe/Warsaw. Local foundation source: `ffc472d`. Read actual Git state before resuming; documentation follow-ups may be on another local branch. The [tracker](FRONTEND_TASK_TRACKER.md) owns statuses and [PLAN](PLAN.md) owns scope.

## Implemented

The canonical rebuild is `darve-frontend`, a separate local React/TypeScript/Vite repository. It contains the requested layers, typed lint/import boundaries, public environment validation, QueryClient composition, lazy public routing/error pages, preliminary design tokens, GSAP/Framer Motion adapters, test tooling, Husky hooks and a GitHub Actions definition. Only `/` and the not-found route exist. The homepage explicitly describes an unconnected foundation.

[F00 evidence](FRONTEND_SKELETON.md) records the successful local gate, browser/visual checks, dependency setup and resolved setup failures. These qualify that foundation snapshot, not future features or deployed operation. The frontend GitHub remote is configured; dev is bootstrapped/protected and implementation PR #1 passed its current-head light hosted gate and merged. Future main rules require full frontend release acceptance before stable use. [FW-02](FW02_GIT_CI_IMPLEMENTATION.md) records source/controls/proof. Main and the first full hosted release acceptance remain unexercised; nothing is deployed.

## Not implemented or verified

- F01 selected-screen/component audit and finished visual system.
- F02 packaged backend contracts, real API transport/proxy, sessions/CSRF, authorization/cache isolation and realtime integration.
- Actual creator, guest checkout/private receipt, OBS, staff/support and coins/templates journeys.
- External provider/payment/Resend delivery acceptance or deployment. The shell makes no business API requests and requires no Docker services.

## Confirmed decisions

Use the selected React/Vite stack and preserve F dashboard, M/R OBS and A contribution visual references. The screenshot landing matches the standalone template source; this does not prove the current hosted deployment revision. Start with React local state plus TanStack Query and URL state, without an extra global store. GSAP and Framer Motion have distinct presentation responsibilities.

Use task branches/PRs into dev with light hosted validation; main is reserved for stable release source with full frontend acceptance before merge. Branch identity does not prove deployment. Work locally first. Resend is selected for backend staff email. Hosting, real credentials/senders, custody/retention, workload/monitoring and deployment qualification remain in the [deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md). Specific real journeys still need their prerequisites before they can pass.

## Next action

FW-01 documentation and FW-02 Git/CI engineering/dev integration are complete for their recorded scopes. The next product work is F01 reference/component inventory, followed by F02 contract/authority mapping under its authorized scope. Do not repeat F00 or start every planned feature. Use the [new-chat template](NEW_CHAT_TASK_TEMPLATE.md) to resume with one explicit task/batch. Recheck ports, services, dirty work and sibling backend source/schema before any API test; their earlier state is not guaranteed.
