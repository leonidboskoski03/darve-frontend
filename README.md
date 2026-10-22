# Darve frontend

Canonical new frontend workspace. React + TypeScript + Vite, separate from the existing backend. Historical projects remain reference material; no old authentication or simulated workflows are imported. Preserve the selected F dashboard, M/R OBS and A contribution direction. The homepage is an explicitly labelled foundation preview, not the rebuilt landing page or a connected product.

## Start locally

Use Node from `.nvmrc` and npm 11. In PowerShell use `npm.cmd` if script execution policy blocks `npm`.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. No backend or Docker services are required for F00; the shell makes no API calls. No credentials are needed. Copy `.env.example` to `.env.local` only if changing the public environment label. Every `VITE_*` value is browser-visible. Provider keys belong in backend configuration.

## Verify

```powershell
npm.cmd run check
npx.cmd --no-install playwright install chromium
npm.cmd run test:e2e
```

`check` includes formatting, typed ESLint and architecture boundaries, architecture regression cases, documentation links, unit/component checks, TypeScript and a production build. Browser tests consume that build; rebuild after changing source. `test:watch` is for iteration. CI uses `npm ci`, runs the same checks and installs Chromium. Hooks provide fast staged checks and a complete pre-push gate; CI remains authoritative.

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

Current product capability is the F00 foundation. Workflow documentation is maintained alongside it; feature implementation, provider/payment acceptance, publication, hosted CI and deployment remain unfinished. A local build is not an end-to-end acceptance claim.
