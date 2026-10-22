# Frontend API contract matrix

Owner: F02. Status: catalogue scaffold; exact endpoints, schema exports, cookies/proofs, CSRF and query keys are **not yet mapped or wired**. This file does not define a new API. [INTEGRATION](INTEGRATION.md) owns transport/security/state rules. The backend catalogue and current feature contracts own actual routes and behavior.

The backend reference root is `../darve-backend`. Start with `docs/API_DTO_COMPATIBILITY_CATALOGUE.md`, `docs/B11_CONSUMER_COMPATIBILITY.md` and the relevant current owner below. Newer B13–15 contracts supersede earlier consumer-handoff scope exclusions.

| Journey                                                  | Backend owning records to inspect                                                                                                      | Frontend batch | Mapping/wiring             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------- |
| Creator session, profile, terms and provider connections | `B02_SESSION_INSPECTION.md`, `B02_PROFILE_CONNECTIONS_AND_TERMS.md`, `B02_AUTHENTICATION_AND_CONNECTIONS.md`                           | F02/F03        | UNMAPPED / NOT IMPLEMENTED |
| Collection, suggestions and acceptance                   | `B04_COLLECTION_TECHNICAL_CONTRACTS.md`, `B05_PROJECTION_TECHNICAL_CONTRACTS.md`, `B06_ACCEPTANCE_TECHNICAL_CONTRACTS.md`              | F04            | UNMAPPED / NOT IMPLEMENTED |
| Dashboard, analytics and declaration                     | `B11_DASHBOARD_IMPLEMENTATION_PLAN.md`, `B11_CONSUMER_COMPATIBILITY.md`, `B10_COMPLETION_IMPLEMENTATION_PLAN.md`                       | F05            | UNMAPPED / NOT IMPLEMENTED |
| Guest checkout/private receipt and receiving readiness   | `B07_STRIPE_CHECKOUT_CONTRACTS.md`, `B08_PAYPAL_CHECKOUT_CONTRACTS.md`, `B12_INT_02_CHECKOUT_READINESS.md`, `B09_FUNDING_CONTRACTS.md` | F06            | UNMAPPED / NOT IMPLEMENTED |
| OBS grant, snapshot, SSE and QR                          | `B06_OVERLAY_TECHNICAL_CONTRACTS.md`, `B11_CONSUMER_COMPATIBILITY.md`, current B15 consumer contracts                                  | F07            | UNMAPPED / NOT IMPLEMENTED |
| Staff identity/code, membership and permissions          | `B13_01_STAFF_TECHNICAL_CONTRACTS.md`, `B13_02_STAFF_ACCESS_IMPLEMENTATION.md`, `B13_04_RUNTIME_ACCEPTANCE.md`                         | F08            | UNMAPPED / NOT IMPLEMENTED |
| Tickets, moderation and controlled recovery              | `B14_01_SUPPORT_TECHNICAL_CONTRACTS.md`, `B14_04_COMBINED_ACCEPTANCE.md`, current B13 moderation contracts                             | F08            | UNMAPPED / NOT IMPLEMENTED |
| Missions, coins, prices and template entitlements        | `B15_01_COIN_TECHNICAL_CONTRACTS.md`, `B15_03_TEMPLATE_ENTITLEMENTS_IMPLEMENTATION.md`                                                 | F09            | UNMAPPED / NOT IMPLEMENTED |

## Required mapping before implementation

Each concrete operation must name:

- Backend source/contract revision and packaged public-contract digest/version; browser-safe exported schema/helper.
- Exact method/path, request and response/envelope, relevant status/error semantics and availability.
- Creator/staff/guest/overlay authority, resource ownership, cookie/CSRF/redirect/proof boundary and cleanup on expiry/revocation.
- Idempotency/replay/uncertainty rules; never infer automatic mutation retries from read-cache policy.
- Query key/caching/cancellation/late-response behavior and how a change invalidates related snapshots.
- Realtime resource/version/cursor/freshness/resync behavior if applicable.
- Pure mapping versus transport responsibilities and safe user-facing error states.
- Contract/negative/local API/browser acceptance evidence and explicitly pending provider observations.

Put implemented operation details in a feature-owned section/record and link them here; do not create a second copy of every backend schema. If implementation and authoritative contract differ, resolve the discrepancy under the owning backend task rather than inventing a frontend compatibility layer that hides it. Tests using synthetic fixtures remain distinguished from actual backend/provider proof.
