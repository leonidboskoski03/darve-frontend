# Darve frontend

Canonical new frontend workspace. React + TypeScript + Vite, separate from the existing backend. Historical projects remain reference material; no old authentication or simulated workflows are imported. Preserve the selected F dashboard, M/R OBS and A contribution direction. The homepage rebuilds the selected standalone landing. Creator entry, server terms and connection management use the current API when configured; registered-development-app sign-in and purpose consent have actual founder-assisted evidence. Live collection and deployment remain separate.

## Start locally

Use Node from `.nvmrc` and npm 11. In PowerShell use `npm.cmd` if script execution policy blocks `npm`.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. The default presentation preview needs no backend, Docker or credentials and makes no API calls. The optional exact public API origin enables actual session inspection/logout and creator onboarding; see [isolated local API setup and acceptance](docs/LOCAL_API_COMPOSITION.md). Copy `.env.example` to `.env.local` only for documented public settings. Every `VITE_*` value is browser-visible. Provider keys belong in backend configuration.

## Verify

```powershell
npm.cmd run check
npx.cmd --no-install playwright install chromium
npm.cmd run test:e2e
```

`check` includes formatting, typed ESLint and architecture boundaries, architecture regression cases, documentation links, unit/component checks, TypeScript and a production build. Browser tests consume that build; rebuild after changing source. `test:watch` is for iteration. Dev PR CI uses light formatting/lint/import/build/type/link checks (formatting/links for prose-only diffs). Main-targeted release CI runs the full gate, audit and Chromium browser acceptance. Hooks provide fast staged checks and a complete pre-push gate; CI remains authoritative.

## Engineering records

- [Documentation index](docs/README.md)
- [Current state](docs/CURRENT_STATE.md) and [task tracker](docs/FRONTEND_TASK_TRACKER.md)
- [Development workflow](docs/WORKFLOW.md) and [Git/CI setup](docs/GIT_AND_CI_SETUP.md)
- [New-chat task template](docs/NEW_CHAT_TASK_TEMPLATE.md)
- [Implementation batches](docs/PLAN.md) and [foundation evidence](docs/FRONTEND_SKELETON.md)
- [Architecture and enforcement](docs/ARCHITECTURE.md)
- [Engineering standards](docs/ENGINEERING.md)
- [Design and motion systems](docs/DESIGN_AND_MOTION.md)
- [API, identity and realtime integration](docs/INTEGRATION.md)
- [Environments and security](docs/OPERATIONS.md), [deployment checklist](docs/DEPLOYMENT_PREPARATION_CHECKLIST.md)
- [Contributor instructions](AGENTS.md)

Current capabilities include the foundation, shared design/motion primitives, pinned API contracts, creator session/transport isolation and reviewed overlay v1/v2 realtime with disposable actual API proof. The [local runbook](docs/LOCAL_API_COMPOSITION.md) includes separate session, realtime and creator/terms acceptance commands. [F03 evidence](docs/F03_CREATOR_CONNECTION_IMPLEMENTATION.md) records the standalone comparison and actual API qualification. Workflow documentation and hosted light development CI are established. Registered-app creator identity/consent is qualified locally; actual connected collection, payment/OBS and other feature journeys, the first full hosted release qualification and deployment remain unfinished. A local build is not an end-to-end acceptance claim.
