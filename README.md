# Darve frontend

Canonical new frontend workspace. React + TypeScript + Vite, separate from the existing backend. Historical projects remain reference material; no old authentication or simulated workflows are imported. Preserve the selected F dashboard, M/R OBS and A contribution direction. The homepage rebuilds the selected standalone landing. Creator entry, server terms and connection management use the current API when configured; registered-development-app sign-in and purpose consent have actual founder-assisted evidence. Live collection and deployment remain separate.

## Run Darve locally

Use the Node version in `.nvmrc` and npm 11. On Windows, use `npm.cmd` if PowerShell blocks `npm`.

1. In the backend checkout, start Docker Desktop, run `npm ci` once, then run `npm run local:up`. Run `npm run local:seed` if the test creator or display is missing. [Backend runbook](https://github.com/leonidboskoski03/darve-backend/blob/dev/docs/BACKEND_DOCKER.md#run-darve-locally)
2. In this checkout, run `npm ci` once and copy [.env.example](.env.example) to `.env.development.local`. Run `npm run dev` and open [Darve on localhost](http://localhost:5173). Use `localhost` throughout so cookies and API callbacks agree.
3. Sign in with a configured provider, or run `npm run local:creator` and open [the local creator sign-in](http://localhost:3103) within two minutes. This signs in to the seeded creator on the full Docker stack. Open Dashboard, Payout settings, or OBS display. An accepted sandbox challenge can be opened from challenge history. Expired or funded challenges still show their funding state and close checkout.
4. Stop Vite with Ctrl+C and run `npm run local:down` in the backend checkout. If a port is busy, identify its owner and stop that process or stack first. Keep ports 5173 and 3000 so origins still match.

With the app and a seeded sandbox challenge running, `npm run test:core:local` runs the headless walkthrough. Install Chromium once with `npx playwright install chromium`. The walkthrough checks the existing payout connections and the public contribution and OBS pages, then revokes its own OBS grant and creator session. Use `npm run test:core:local -- --require-open-checkout` with a fresh sandbox challenge to require the checkout form. The walkthrough verifies receiving without submitting payment.

Quick Pay appears as an additional sandbox option on a contribution page with PayPal receiving available. Enter an amount and review the displayed fee to load PayPal's eligible wallet or card buttons. The existing PayPal and Stripe checkouts remain available below it.

When the backend enables Stripe Embedded Checkout, **Pay on this page** opens Stripe's card form after the viewer reviews the fee. Apple Pay and Google Pay appear when Stripe considers the browser, device and HTTPS payment domain eligible. Follow the [backend sandbox setup](https://github.com/leonidboskoski03/darve-backend/blob/dev/docs/B07_STRIPE_CHECKOUT_CONTRACTS.md#embedded-sandbox-checkout).

## Staff access locally

`npm.cmd run dev:staff` opens the independent staff entry at `http://localhost:5176`. It uses the separate browser-public example in [env/staff](env/staff/.env.example); omit its paired addresses for the unavailable/no-request state. A configured sign-in needs the matching admin API and reviewed identity/email settings. [Staff operations](docs/OPERATIONS.md#separate-staff-entry) and [F08-03 qualification](docs/F08_STAFF_AND_SUPPORT_IMPLEMENTATION.md#f08-03-staff-entry-and-authority) own the exact setup and controlled local API proof. This command does not start/configure a backend or send email.

## Verify

```powershell
npm.cmd run check
npx.cmd --no-install playwright install chromium
npm.cmd run test:e2e
```

`check` includes formatting, typed ESLint and architecture boundaries, architecture regression cases, documentation links, unit/component checks, TypeScript and a production build. Browser tests consume that product build; rebuild after changing source. `test:e2e` also builds its isolated synthetic fixture entries into ignored `dist-acceptance/` and serves them separately on 4175; the product build excludes those entries. `test:watch` is for iteration. Dev PR CI uses light formatting/lint/import/build/type/link checks (formatting/links for prose-only diffs). Main-targeted release CI runs the full gate, audit and Chromium browser acceptance. Hooks provide fast staged checks and a complete pre-push gate; CI remains authoritative.

## Engineering records

F06 adds the selected public contribution layout and private receipt reads. A configured guest route uses independent public/guest clients without starting creator login. Ordinary payment creation remains deliberately disabled; [F06 scope and prerequisites](docs/F06_CONTRIBUTION_IMPLEMENTATION.md) records the remaining checkout/capture and actual sandbox work.

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

[F04-02](docs/F04_COLLECTION_IMPLEMENTATION.md#f04-02-creator-workspace-and-collection-controls) adds the responsive creator workspace at `/collection`, all-provider source selection and actual API Start/status/Stop/cancel. A known `/collection/:roundId` link reloads from server state. Configured API, creator session and current terms are required; the default offline preview keeps those prerequisites explicit. The runbook includes controlled disposable collection acceptance. Live chat/analysis/receiving and recovery without a known round link remain separate requirements.

[F04-03](docs/F04_COLLECTION_IMPLEMENTATION.md#f04-03-suggestion-review-and-challenge-acceptance) adds safe review at `/collection/:roundId/suggestions`, full grouped credits, shortlist metadata, exact confirmed acceptance and owned challenge status. It preserves other ideas and challenges from other rounds. The [runbook](docs/LOCAL_API_COMPOSITION.md) includes controlled review acceptance; configured commercial-policy/disclosure discovery and actual live provider/model/receiving qualification remain explicit requirements.

[F05](docs/F05_DASHBOARD_IMPLEMENTATION.md) adds `/dashboard`, retained history at `/challenges`, challenge detail and known-round analytics. Applied date/timezone/broadcast filters live in the URL; verified contributions keep exact per-currency amounts and explicit unavailable states. Funded challenges can receive a confirmed original/authorized-stream creator declaration, with safe replay and canonical status reconciliation. The runbook includes disposable reporting/financial-repository proof; live provider/payment verification remains separate.
