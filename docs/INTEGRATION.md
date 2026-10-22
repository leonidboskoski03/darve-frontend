# API, identity and realtime integration

Status: planned F02 contract/transport work. F00 contains no fake endpoints, authentication, automatic provider calls or business API queries. Do not count the frontend build as backend interoperability.

## Reproducible contracts

The existing backend exports the browser-safe `@darve/contracts` package and B11 consumer adapters. Its package currently exports built `dist` and depends on Zod. A live `file:../darve-backend/...` link would silently follow a changing checkout and would fail independent CI. Do not use that as the final dependency.

F02 must build/package public contracts from an exact reviewed backend revision into a versioned local tarball or private registry artifact. Record source SHA, artifact digest and exact dependency/lockfile; verify only browser-safe public files/dependencies are included. Prefer a committed reviewed tarball plus provenance manifest for initial independent local/CI use if no registry exists. This packaging is a planned choice to validate in F02, not an artifact already supplied. No schema copying or fake frontend DTOs. Add the narrowly reviewed `services/contracts/` import exception with boundary regression cases once packaging is established; current lint rejects all direct `@darve/` imports.

Map each feature to actual endpoint/method, request/envelope schema, response status, authority, CSRF, idempotency, server availability and consumer helper. Review backend API/DTO catalogue, B02 session/security contracts, B06 overlay, B07/B08 financial/checkout, B11 compatibility, B13/B14 staff/support and B15 coins before implementing the corresponding client. Fix stale backend handoff notes through their current owners; older B11 exclusions do not erase newer B13–15 APIs.

## Authentication and authorization

| Journey | Authority                                                      | Important boundary                                                                                                                          |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Creator | Backend creator session and provider-purpose grants            | Browser session is distinct from provider/bot credentials. Current terms and owner/resource checks remain server-side.                      |
| Staff   | Independent staff session, password proof and Darve email code | Distinct entry/origin/cookie/API policy, roles and step-up. Resend delivery is backend-only. Do not reuse creator Query keys/client/proofs. |
| Guest   | Challenge/terms-bound contribution and private receipt proof   | Accountless viewing does not make receipts public. No shared creator/guest cache or public secret URLs.                                     |
| OBS     | Read-only scoped overlay bootstrap/grant                       | Private source access link is distinct from a display/session identifier. No owner data or browser persistence shortcuts.                   |

Implement real session states (loading, signed out, authenticated, expired/unavailable) from existing contracts. Route guards improve UX; every backend request still enforces permission. Validate safe internal return navigation; provider redirects must originate from the backend's approved flow. Capture/clean bootstrap fragments according to the owning contract before telemetry or navigation records can observe them.

On sign-out, authority change or terminal expiry: cancel scoped queries, abort transport, close streams and clear private cache and drafts. A late prior-session response must not populate a new session's cache. Use session-scoped clients/cache lifecycle or equivalent tested generation fences; document the exact mechanism in F02. A globally cached session result or a hidden button is not sufficient isolation.

## Transport and server state

Network and storage enter through named service modules. Use native Fetch with AbortSignal and the documented cookie/CSRF mechanism; do not forward credentials to arbitrary URLs. Public JSON parsing uses supplied `parseConsumerResponse`, status and Content-Type. Redirects, OAuth, empty responses and SSE have separate handling. Do not echo raw response bodies or exception messages into the UI.

TanStack Query owns backend snapshots. Feature query keys include authority scope, resource ID, reporting filters and pagination. Query defaults disable retries; a feature may add bounded retries to safe reads respecting server delay and cancellation. Explicitly disable automatic replay for payment, acceptance, recovery and redemption commands. Refreshing a stale snapshot is separate from resubmitting a command. Payment uncertainty remains uncertainty, never an invented failed/successful result.

Use exact backend money helpers and integer/minor-unit strings. No floating-point conversion, merged currency totals or event-delta accumulation. Guest inputs keep current terms/version/recipient binding; Stripe redirect and PayPal approval/capture remain distinct. Browser return alone does not prove canonical payment success.

## Realtime and OBS

Create one resource/authority-owned subscription with explicit cleanup, parser validation and reconnect/backoff policy from the contract. Initial `resync_required` refetches the authoritative snapshot on the same connection when specified; do not loop through reconnect/bootstrap. Server-provided versions/cursors govern duplicates, ordering and resource mismatch. Source removal, revoked proof and stale freshness clear public content as required.

Reuse backend overlay reducers/snapshot/event helpers and their monotonic timing. The existing 15-second overlay freshness rule is a backend handoff requirement, not a new frontend setting. Deadline zero may request a fresh snapshot but cannot close a server round. QR is the exact selected challenge contribution URL; changing the OBS selection never transfers another challenge's money. Heartbeats must not duplicate financial effects.

## Error and form behavior

Preserve sign-in/denied/not-found/conflict/throttled/unavailable/protocol/offline distinctions. A 404 is not an empty list; a 409 requires authoritative refresh before another deliberate action. Safe copy may include the backend's safe code/request ID, never raw stacks/provider payloads. Forms preserve harmless text when appropriate, show linked field errors and prevent double submits. Exact terms/amount/recipient/price confirmation must be repeated if the server says they changed.

F02 acceptance must prove these boundaries with captured synthetic contract fixtures and real local API tests. F06/F10 own actual sandbox/provider/QR acceptance, coordinated separately with fresh guest browsers and visible approvals. Do not reuse a consumed permit or already approved checkout as proof of a fresh journey.
