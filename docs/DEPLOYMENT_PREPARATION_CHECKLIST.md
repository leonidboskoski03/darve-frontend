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
- Resolve backend `B15-03-G01` before claiming complete staging/release qualification: migration-replay and reviewed provisioning fixtures must match the current migration chain. The F09-05 v2 bootstrap correction does not waive these existing gates; see [B15 handoff](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#fresh-source-diagnosis-resumed-2026-11-05).
- Verify actual HTTPS origins, deep-link fallback, API proxy, credentials/CSRF, safe redirects, separate staff/guest/OBS authority and route-specific CSP/referrer/cache policies.
- Confirm all enabled screens have real loading/error/expired/unavailable states, revoked authority clears private caches/streams, and no unfinished capability is falsely enabled.
- Verify chosen designs on actual devices and OBS, physical QR destination, fresh-browser sandbox payment journeys, accessibility and agreed workload/performance limits.
- Record monitoring/alert owners, scrubbed telemetry and artifact retention, rollback compatibility, operator checks and separately authorized release/deployment steps.

## Coin and template activation handoff (F09)

F09 local qualification does not enable ordinary earning/redemption or approve example values. Carry these decisions into the separately authorized activation/release checkpoint; their backend and operational owners remain authoritative.

| Required decision or proof                                                                             | Owner                              | Activation prerequisite                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six prospective mission rewards, unlock pacing and exact template prices                               | Founder/product and B15            | Approve finite real values and intended new-only earning behavior. Local 20/12/5 coin examples are not defaults.                                                                |
| Program/journal identities, private consumer/cursor configuration and constrained serving/worker roles | B15 and R02/B12-INT-01             | Match all independent bindings and readiness checks in the intended environment. Browser flags do not grant authority; secrets stay server-side.                                |
| Reviewed catalogue, asset/approval hashes, versions, licensing and withdrawal ownership                | Product/asset owner and B15        | Deliberately install only reviewed compatible assets. Preserve old ownership on updates/withdrawal; never execute catalogue-supplied code.                                      |
| Independent journal/frontier storage, key/backup/restore custody and retention/erasure                 | R02/B12-04 and named operator      | Qualify durable hosting, recovery-point/time objectives, retention/deletion and held restore without SQL-only rollback of verified coins or resurrection of revoked access.     |
| Workload, worker/queue/SSE limits, alerts and incident responsibility                                  | B12-02/B12-05 and named operator   | Agree measurable pilot limits, monitoring thresholds and responders. Passing local tests is not a production capacity measurement.                                              |
| Complete source/schema/provisioning qualification                                                      | B06/R02 and B15                    | Resolve B15-03-G01's migration-replay/provisioning mismatch before claiming staging/release acceptance.                                                                         |
| Real origins/identity/mail/provider and physical destination acceptance                                | F10/F11, B13-02 and feature owners | Complete applicable actual HTTPS/OBS/phone/provider journeys and genuine staff Auth0/Resend proof. Preserve founder-deferred F08-EXT01 and the client's unrelated Resend setup. |

All prerequisites above remain open for ordinary activation unless their owning records explicitly qualify the actual target environment. F09's combined [local evidence](F09_COINS_AND_TEMPLATES_IMPLEMENTATION.md#f09-07-combined-local-acceptance-and-handoff) does not replace them.

See [OPERATIONS](OPERATIONS.md) for environment/security rules and [GIT_AND_CI_SETUP](GIT_AND_CI_SETUP.md) for source/CI/release procedure. Resend selection is confirmed; actual sender/domain credentials and delivery remain pending.
