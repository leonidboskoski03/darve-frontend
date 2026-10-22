# Deployment preparation checklist

This record owns the deferred checklist moved from OPERATIONS; backend security, identity, financial and release owners remain authoritative. Local implementation does not close these gates. Current statuses belong to [FRONTEND_TASK_TRACKER](FRONTEND_TASK_TRACKER.md).

## Deferred deployment-preparation checklist

The founder explicitly deferred these prerequisites while local frontend/API integration proceeds. Resend is selected for staff email. Open items retain backend owners; they are not closed by a frontend skeleton.

- B12-INT-01/B13-02: configure actual staff identity/OIDC policy, Resend verified domain/sender and server-side credentials; test real inbox delivery and password/code expiry/replay/rate-limit/revocation/recovery.
- B12-INT-01/feature owners: actual provider/analysis permissions and credentials, reviewed limits, recovery policy, coin rewards and template prices; isolated test settings do not establish production values.
- R02/B12-INT-01: final hosting direction, HTTPS/proxy/ingress, frontend/API/staff/OBS origins, private PostgreSQL/Redis networking, constrained runtime grants, per-process secret injection, key rotation/custody and independent journals/frontiers. Respect existing Fly.io direction until a hosting change is approved.
- R02/B12-04/B13-02: named backup/key/restore operators, acceptable downtime and data-loss objectives, hosted backup/PITR/expiration evidence, retention/deletion policy and held-restore proof. Avoid resurrecting revoked proofs or removed content after restore.
- B12-02/B12-05: agree actual pilot traffic and critical-request/backlog/resource limits; measure API/database/worker/SSE/OBS behavior, bounded outages, duplicate/delayed provider events and recovery; name alert responders and incident ownership; produce usable runbooks.
- B12-03f/B12-05: final connected browser/provider/OBS/QR/sandbox acceptance, documented exceptions and explicit pilot/release decision. D02 terms, B03 bot identities and D07/B07-ACT-01 payment-exposure gates remain applicable.

Deferral never authorizes external exposure, live payments, persistent migrations, all-feature enablement, secret purchase/rotation or deployment. Specific local real-provider journeys may need their external prerequisites earlier; record them as pending rather than fabricating a pass.

## Frontend-specific activation checks

- Pin the exact frontend source/build/contract revisions and compatible backend source/schema/configuration; define immutable asset and HTML/config caching.
- Verify actual HTTPS origins, deep-link fallback, API proxy, credentials/CSRF, safe redirects, separate staff/guest/OBS authority and route-specific CSP/referrer/cache policies.
- Confirm all enabled screens have real loading/error/expired/unavailable states, revoked authority clears private caches/streams, and no unfinished capability is falsely enabled.
- Verify chosen designs on actual devices and OBS, physical QR destination, fresh-browser sandbox payment journeys, accessibility and agreed workload/performance limits.
- Record monitoring/alert owners, scrubbed telemetry and artifact retention, rollback compatibility, operator checks and separately authorized release/deployment steps.

See [OPERATIONS](OPERATIONS.md) for environment/security rules and [GIT_AND_CI_SETUP](GIT_AND_CI_SETUP.md) for source/CI/release procedure. Resend selection is confirmed; actual sender/domain credentials and delivery remain pending.
