# API, identity and realtime integration

Status: F02-01 source/contracts, F02-02 transport/creator session/isolation and F02-03 reviewed overlay v1/v2 realtime are locally qualified. [F02 evidence](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md) separates synthetic browser cases from actual disposable API acceptance. Actual provider login and full feature authority journeys remain with their owners. Do not count the frontend build as backend interoperability.

## Reproducible contracts

The existing backend exports the browser-safe `@darve/contracts` package and B11 consumer adapters. Its package currently exports built `dist` and depends on Zod. A live `file:../darve-backend/...` link would silently follow a changing checkout and would fail independent CI. Do not use that as the final dependency.

[F02-01](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md) now supplies a committed revision-pinned tarball/provenance/lockfile and a narrow services/contracts/index.ts facade. `contracts:check` verifies its browser-only distribution and map references without a sibling checkout. Refresh only as a reviewed source/artifact/map change; never copy schemas or use a live sibling link. The [contract matrix](FRONTEND_API_CONTRACT_MATRIX.md) records exact operations and current 202/staff/support/moderation/overlay-v2 gaps.

Map each feature to actual endpoint/method, request/envelope schema, response status, authority, CSRF, idempotency, server availability and consumer helper. Review backend API/DTO catalogue, B02 session/security contracts, B06 overlay, B07/B08 financial/checkout, B11 compatibility, B13/B14 staff/support and B15 coins before implementing the corresponding client. Fix stale backend handoff notes through their current owners; older B11 exclusions do not erase newer B13–15 APIs.

## Authentication and authorization

| Journey | Authority                                                      | Important boundary                                                                                                                          |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Creator | Backend creator session and provider-purpose grants            | Browser session is distinct from provider/bot credentials. Current terms and owner/resource checks remain server-side.                      |
| Staff   | Independent staff session, password proof and Darve email code | Distinct entry/origin/cookie/API policy, roles and step-up. Resend delivery is backend-only. Do not reuse creator Query keys/client/proofs. |
| Guest   | Challenge/terms-bound contribution and private receipt proof   | Accountless viewing does not make receipts public. No shared creator/guest cache or public secret URLs.                                     |
| OBS     | Read-only scoped overlay bootstrap/grant                       | Private source access link is distinct from a display/session identifier. No owner data or browser persistence shortcuts.                   |

F02-02 implements creator loading, signed-out, authenticated, expired/unavailable and confirmed/unconfirmed logout from existing contracts. CSRF remains in memory. Every inspection rotates private authority before reading; focus rechecks can therefore clear private drafts. Route guards for future private routes improve UX; every backend request still enforces permission. Validate safe internal return navigation; provider redirects must originate from the backend's approved flow. Capture/clean bootstrap fragments according to the owning contract before telemetry or navigation records can observe them.

On sign-out, authority change or terminal expiry: cancel scoped queries, abort transport, close streams and clear private cache and drafts. A late prior-session response must not populate a new session's cache. Use session-scoped clients/cache lifecycle or equivalent tested generation fences; document the exact mechanism in F02. A globally cached session result or a hidden button is not sufficient isolation.

## Transport and server state

Network and storage enter through named service modules. `services/api` supplies native Fetch with AbortSignal, exact origin/audience paths and the documented cookie/CSRF mechanism; it does not forward credentials to arbitrary URLs. Response parsing validates declared status, Content-Type and exact public schemas; the pinned `parseConsumerResponse` handles safe errors. Explicit 202 becomes pending without status coercion, and declared 204 must be empty. Generic JSON rejects redirects; OAuth navigation and SSE have separate handling. Do not echo raw response bodies or exception messages into the UI. [Local composition](LOCAL_API_COMPOSITION.md) documents direct CORS/origin behavior and disposable storage.

`services/server-state` supplies independent authority generations/QueryClients, cancellation, cleanup registration and late-result fencing. App composition remounts the creator subtree on rotation to clear private React state. Confirmed logout invalidates other creator tabs; unconfirmed logout hides private content and requires explicit revoke retry. This lifetime policy supplies building blocks for future staff/guest/reader clients, not their completed login/bootstrap flows.

TanStack Query owns backend snapshots. Feature query keys include authority scope, resource ID, reporting filters and pagination. Query defaults disable retries; a feature may add bounded retries to safe reads respecting server delay and cancellation. Explicitly disable automatic replay for payment, acceptance, recovery and redemption commands. Refreshing a stale snapshot is separate from resubmitting a command. Payment uncertainty remains uncertainty, never an invented failed/successful result.

Use exact backend money helpers and integer/minor-unit strings. No floating-point conversion, merged currency totals or event-delta accumulation. Guest inputs keep current terms/version/recipient binding; Stripe redirect and PayPal approval/capture remain distinct. Browser return alone does not prove canonical payment success.

## Realtime and OBS

Create one resource/authority-owned subscription with explicit cleanup, parser validation and reconnect/backoff policy from the contract. Initial `resync_required` refetches the authoritative snapshot on the same connection when specified; do not loop through reconnect/bootstrap. Server-provided versions/cursors govern duplicates, ordering and resource mismatch. Source removal, revoked proof and stale freshness clear public content as required.

F02-03 implements that policy in `services/realtime` for the existing overlay reader stream. Supply exact origin/display/grant/protocol and a fresh overlay scope; bootstrap is separate. Start once, subscribe to the safe view and dispose/stop on unmount or authority change. Stop is terminal. V1 omits the protocol query and reuses the pinned reducer; v2 explicitly selects protocol 2 and retains its complete template descriptor through strict validation/version/freshness handling. No silent downgrade or legacy coercion is supported. Template renderer assets and the production OBS entry remain F07/F09.

Disconnect/protocol loss clears presentation. Validated resource cursors reconnect with GET only, honoring bounded server/backoff timing. Terminal denial/unavailable/malformed responses stop rather than signing in, reissuing a grant or replaying a command. Comments do not refresh clock validity. Snapshot reads are authority-scoped and discarded after applying the current full projection; delayed results cannot restore an older selection. [F02-03 evidence](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md#f02-03-resource-owned-realtime) owns exact limits and tests. There is no creator dashboard/collection SSE endpoint in the pinned backend. Support streams retain their separate public-schema gap under F08.

Reuse backend overlay reducers/snapshot/event helpers and their monotonic timing. The existing 15-second overlay freshness rule is a backend handoff requirement, not a new frontend setting. Deadline zero may request a fresh snapshot but cannot close a server round. QR is the exact selected challenge contribution URL; changing the OBS selection never transfers another challenge's money. Heartbeats must not duplicate financial effects.

## Error and form behavior

Preserve sign-in/denied/not-found/conflict/throttled/unavailable/protocol/offline distinctions. A 404 is not an empty list; a 409 requires authoritative refresh before another deliberate action. Safe copy may include the backend's safe code/request ID, never raw stacks/provider payloads. Forms preserve harmless text when appropriate, show linked field errors and prevent double submits. Exact terms/amount/recipient/price confirmation must be repeated if the server says they changed.

F02 acceptance must prove these boundaries with captured synthetic contract fixtures and real local API tests. F06/F10 own actual sandbox/provider/QR acceptance, coordinated separately with fresh guest browsers and visible approvals. Do not reuse a consumed permit or already approved checkout as proof of a fresh journey.
