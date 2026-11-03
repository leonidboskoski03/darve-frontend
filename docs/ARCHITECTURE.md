# Architecture

Status: foundation, shared presentation, contract/transport/session/realtime boundaries, F03 creator entry, F04 collection/review controls and F05 dashboard/history/declaration are implemented. Feature evidence remains with each owner. React + TypeScript + Vite is selected. React Router uses its browser/data router, not Framework Mode or Next.js. The existing Darve backend remains the only owner of permissions, collections, payments, funding, declarations, moderation, support recovery and coin/template rules.

## Responsibilities

```text
src/
  app/               root mounting, providers, process-wide composition
  routes/            URL structure, lazy route modules, layouts, loaders, UI guards
  design-system/     tokens, accessible visual primitives, visual states
  motion/            shared timing, engine adapters, lifecycle and motion policy
  features/          named business capability slices; UI, forms, commands, queries
  entities/          named domain vocabulary and pure presentation transformations
  services/          API/contracts, realtime, config, telemetry and infrastructure
  shared/            small domain-independent utilities and types
tests/               test setup and browser acceptance
tools/               quality/architecture tooling
docs/                decisions, plan, acceptance and operations
```

No empty business implementations or universal barrel exports. `entities/` and `shared/` deliberately start with responsibility records until concrete callers exist. A slice can have `ui/`, `model/`, `api/` and `lib/` only when its size needs them; do not create every subfolder for every feature.

## Allowed dependencies

| Importer      | May import lower layers                                             |
| ------------- | ------------------------------------------------------------------- |
| app           | routes, features, entities, services, design-system, motion, shared |
| routes        | features, entities, services, design-system, motion, shared         |
| features      | entities, services, design-system, motion, shared                   |
| entities      | services, shared                                                    |
| services      | shared                                                              |
| motion        | design-system, shared                                               |
| design-system | shared                                                              |
| shared        | shared only                                                         |

Same-layer internal imports are allowed except sibling feature/entity slices. Compose two features in a route; do not import one feature's state into another. Entities remain framework-independent models; importing service contract types/pure adapters is allowed, running network effects from entities is not. Separate entities must not couple to one another through a hidden hierarchy.

Feature, entity and service slice boundaries expose small explicit named exports via `index.ts`. Cross-boundary imports target `@/features/collection/index`, not private UI/query files. Internal imports use relative paths. `design-system/` and `motion/` expose explicit component/adapter modules; importing the whole library is unnecessary. Application composition can inject capabilities without reversing dependencies.

Only `services/contracts/index.ts` may import the exact root `@darve/contracts` package. It exposes a reviewed named subset from the pinned browser artifact. Direct feature/other-service imports, deep package paths, private server workspaces and Node builtins remain forbidden; regression cases cover the exception.

## Enforcement

Typed ESLint runs local architecture rules from [eslint-architecture.mjs](../tools/eslint-architecture.mjs). They check static imports, aliases, relative paths, re-exports, dynamic imports and type imports. Computed import paths and `require` are rejected. Cross-slice imports and repository escapes fail. Network/browser storage access is restricted to services; direct animation-engine imports are restricted to motion. Public environment access is centralized. Raw HTML insertion is forbidden. Inline rule disabling is off.

[Architecture regression cases](../tools/architecture.test.mjs) prove rejected imports fail and legitimate composition passes. These are developer guardrails, not a JavaScript sandbox: indirect aliases, arbitrary string evaluation and dependency internals require review. Do not claim static lint proves security. TypeScript resolves actual imports; lint establishes ownership. Circular dependencies within otherwise permitted modules must be rejected during review; add a graph check if the populated feature tree warrants it.

## State and ownership

- TanStack Query caches server snapshots; feature queries use resource/authority-scoped keys. Services creates the QueryClient and performs transport. Do not combine Query's cache with a second route-loader data cache for the same resource. Loaders may prefetch through the same query definition when useful.
- React state/reducers hold transient state. URLs own shareable navigation/filters. Start without Redux/Zustand. Browser storage needs a reviewed use, schema and privacy policy; it never stores session/overlay/guest secrets.
- Creator session infrastructure is a pure external store in services; React context/status lives in its feature, composed by app. Authority rotation creates a new QueryClient/generation and remounts the private subtree. Scope disposal aborts/cancels/clears and runs registered cleanups; private queries use its late-result fence. Other authority lifecycles must compose their own independent scopes.
- Resource-owned realtime in services owns transport/parser/reducer lifecycle, not business commands. Overlay snapshots use strict protocol-specific public contracts and complete authoritative projections; HTTP refetches share the authority QueryClient and leave no stale secondary cache after application. A feature subscribes to the derived view and disposes its scope on unmount. Reconnect never issues grants, logs secrets or transfers creator authority.
- Forms belong to a feature. Pure validation can live in its model or an entity. The backend validates and authorizes every command. Do not infer successful funding or redemption from optimistic state.
- An entity is not a copy of a database row. Reuse public DTO types, then derive minimal view models. Never transport Prisma/server/provider modules into the browser.
- Design primitives have no router, QueryClient, authentication or business policy. Motion is presentation only; meaningful content stays available when motion is disabled.

## Route composition

Routes compose `/`, `/authorize`, `/integrations`, `/terms`, `/collection`, `/collection/:roundId`, `/collection/:roundId/suggestions` and a catch-all with a shared root, safe error element and lazy feature routes. The collection workspace layout lives in routes because it owns navigation; route composition injects creator/session guards and passes navigation intent into independent collection/review features. Router imports stay out of features. Private terms/connections/rounds share their authority QueryClient; OAuth navigation stays inside its service. `services/collection` owns collection commands and receipt/clock validation. `services/suggestions` owns publication-bound pages, versioned dispositions, exact acceptance receipts and source-bound owned challenge reads. Neither introduces a second loader cache or global store. [F04](F04_COLLECTION_IMPLEMENTATION.md) owns acceptance evidence and remaining contract/connected gaps.

F05 adds `/dashboard`, `/challenges`, `/challenges/:challengeId` and `/collection/:roundId/analytics` under the creator workspace. Its route module composes session/current-terms and URL-applied filters; `features/reporting` owns local drafts and confirmation. `services/reporting` validates source/zone/date/resource binding and owns immutable declaration receipts. Server periods and per-currency exact amounts are projections, never duplicated financial state or client deadline arithmetic. Query owns snapshots/refetch; successful declarations invalidate affected resources without optimistic completion counters. No reporting SSE or extra loader cache is introduced. [F05](F05_DASHBOARD_IMPLEMENTATION.md) owns proof and limits.

F06 public challenge (`/contribute/:publicId`) and private receipt (`/receipts[/checkoutId]`) routes have an independent light contribution shell outside the creator route branch. Creator authority now mounts only in that branch; app providers supply generic motion/public-query composition. The contribution feature owns its guest provider, and its service owns distinct public/guest clients and caches. Public requests omit credentials; private GETs use the guest cookie and validate the exact resource. Visibility/page restoration clears private snapshots before fresh reads, disposal fences late results, and provider return cleanup happens before router startup. No creator cache/CSRF, proof URL, storage or monetary command is added. [F06](F06_CONTRIBUTION_IMPLEMENTATION.md) owns the deliberate payment-exposure boundary and evidence.

F07 adds `/obs` to the guarded creator workspace and an independent `overlay.html` entry for `/overlay/:displayId`. The display consumes its private fragment before mounting, bootstraps an independent HttpOnly reader cookie and reuses only the F02-03 overlay scope/transport. It has no creator provider/router/navigation, marketing or motion engines. Owner access links live only in the mounted setup component; they never enter Query or browser storage. Explicit display/preference commands use exact versioned contracts and current creator authority. QR encoding is local and its public payload stays bound to the fresh selected snapshot. [F07](F07_OBS_IMPLEMENTATION.md) owns renderer support, browser/API evidence and separate actual OBS/physical QR acceptance. Production hosting must map the overlay route to its isolated entry; dev/preview implement that rewrite.

F08-03 provides an independent `staff.html` entry, lazy staff routes/feature and `dist-staff` output under `vite.staff.config.ts`. Its `STAFF_PUBLIC_` configuration is separate from the public build's `VITE_` prefix. The API/frontend hostnames must match the backend staff cookie policy; local creator and staff hosts are distinct. No creator provider, dashboard or marketing feature is imported into the verified staff build. `/staff/verify-email` is the pending-code landing entry, separate from the allowlisted final return destinations. Private staff proof stays in its service; canonical session and pending-code reads establish the appropriate phase and fresh QueryClient generation. Visibility, expiry, stop/revocation and authority transitions clear private snapshots, queries and drafts. Only the exact, publicly validated initial staff start omits CSRF; later commands use the relevant staff proof. A reviewed content-free tab-local sign-out marker blocks an unconfirmed logout across reload and never grants authority. [F08-03](F08_STAFF_AND_SUPPORT_IMPLEMENTATION.md#f08-03-staff-entry-and-authority) owns its precise storage schema, runtime/role proof and limits. New ticket/review features still need route composition and real server authorization. Keep feature screens lazy so the isolated OBS reader never downloads staff/dashboard/marketing UI.

UI guards prevent confusing navigation. API authorization is mandatory even when a route is hidden. Protected loaders must not fetch private data before establishing the appropriate authority. On navigation, preserve meaningful document titles, keyboard focus and accessible errors.

F08-04 adds lazy `/support` and `/support/:ticketId` in the existing creator workspace. Current creator identity is required; terms acceptance and business-admission rules never gate asking support. `features/support` owns local drafts/reviewed command intent, while `services/support` owns the eight validated creator operations and its independent body-free Fetch/SSE hints. Detail/history reads share the creator authority QueryClient, with no second stream snapshot/history cache. Resource-bound opaque pages are replaced on authoritative resync; drafts and old/redacted text are cleared. Explicit read/context/reply/create commands retain exact key/body for deliberate uncertain retry. This adapter sends no replay ID, mounts no staff session and never consumes staff notes. [F08-04](F08_STAFF_AND_SUPPORT_IMPLEMENTATION.md#f08-04-creator-support-conversations) owns proof, limitations and cleanup.

F08-05 adds lazy staff `/tickets` and `/tickets/:ticketId`. `features/staff-support` owns the staff Query provider, desk, local forms and reviewed command state; `services/staff-support` owns validated staff-only operations and independently parsed body-free staff hints. Minimal queue revisions allow confirmed claims without private conversation preloading. Public and note histories/read positions remain separate. All ticket commands share a stable ticket-level holder: authoritative resync clears drafts/confirmations while an uncertain exact request survives for explicit retry. Staff scope rotation or lost ticket access unmounts the holder and clears private work. Direct ticket sign-in returns to the existing `/tickets` provider destination. No creator/guest/OBS session or sibling feature is imported by this staff slice. [F08-05](F08_STAFF_AND_SUPPORT_IMPLEMENTATION.md#f08-05-staff-support-workspace) owns qualification; inspection/moderation/recovery remain later tasks.
