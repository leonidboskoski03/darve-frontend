# Architecture

Status: F00 foundation with qualified F01 presentation and F02-01/02/03 contract, transport, creator-session and reviewed overlay realtime boundaries. React + TypeScript + Vite is selected. React Router uses its browser/data router, not Framework Mode or Next.js. The existing Darve backend remains the only owner of permissions, collections, payments, funding, declarations, moderation, support recovery and coin/template rules.

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

F03 composes `/`, `/authorize`, `/integrations`, `/terms` and a catch-all with a shared root, safe error element and lazy creator routes. Routes inject the creator session into the creator-access feature. Private terms/connections use the authority QueryClient; OAuth navigation stays inside its service. Future route groups are public marketing, creator workspace, guest contribution/private receipt, staff portal and isolated OBS display. Their actual URL/authority map belongs to F02 and backend contracts. Staff must have a distinct entry/build/origin policy before real staff access; OBS gets a minimal transparent layout and separately loaded assets rather than the creator shell. Lazy load feature screens and motion sequences so an OBS display does not download the dashboard and marketing experience.

UI guards prevent confusing navigation. API authorization is mandatory even when a route is hidden. Protected loaders must not fetch private data before establishing the appropriate authority. On navigation, preserve meaningful document titles, keyboard focus and accessible errors.
