# F02 contracts and authority implementation

Owner: F02-01. Started 2026-10-27 from clean, synchronized dev `5c4dd18671b86e7986048297e61b712dec9b3c74` on `feat/f02-01-contract-mapping`. [PLAN](PLAN.md) owns batch acceptance; [tracker](FRONTEND_TASK_TRACKER.md) owns status; [contract matrix](FRONTEND_API_CONTRACT_MATRIX.md) and its JSON register own operation mappings. This record owns packaging, verification, decisions and restart evidence. F02-02/03 can extend it for transport/authority/realtime; those capabilities are not implemented here.

## Source and deliverable

The backend source is `e12b84de3959f6fdbd7eba04ffdfa135f6ba47aa`. Its three existing documentation edits in B12 readiness, tracker and roadmap were preserved. Tracked API/admin/contract inputs match that revision; no backend source, configuration, persistent data, Docker service, provider account or email action was changed. Current source/controller/mapper behavior takes precedence over earlier illustrative API catalogues.

The register includes 115 browser operations plus seven excluded health/provider registrations, with actual composition prefixes, source handlers/lines, authority, public schema references, body/query/status/idempotency and frontend owner. It covers the independent admin API, current support/recovery and coins/templates rather than treating old B11 scope exclusions as current product limits. Source hashes cover 117 API/admin files; full backend commit identity also pins referenced domain validators.

Routes are conditionally mounted where their services/configuration require it. A mapped registration does not mean a running or activated feature; missing service/configuration, 404, denied and unavailable responses remain explicit. Inline/source-only validators have recorded integration gaps. The register is reviewed metadata, not a generated API client or proof that every route was exercised.

## Pinned public artifact

| Field      | Qualification                                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency | `@darve/contracts` version 0.0.0, source-owned private package; committed file tarball, not a live sibling directory or published registry release                                                                          |
| Artifact   | [Revision-named tarball](../vendor/contracts/darve-contracts-e12b84de3959f6fdbd7eba04ffdfa135f6ba47aa.tgz), 42,051 bytes                                                                                                    |
| SHA-256    | `15caaa5b967ed4613256041af57fddb5ce7b83fbfa43615b7e94d3427a8e2a11`                                                                                                                                                          |
| Provenance | [Manifest](../vendor/contracts/provenance.json): exact source hashes, compiler/options, distribution file hashes, SHA-512 integrity and 205 runtime exports                                                                 |
| Build      | Git archive of exact source; backend TypeScript 5.9.3, Node 24.16.0, npm 11.16.0 and Zod 4.6.5. Explicit LF, no source/declaration maps, build cache or Node ambient types. Distribution package has no executable scripts. |
| Contents   | 52 files: 25 public JS modules, matching declarations, package metadata and original reviewed README. No private workspaces, source maps, .env, credentials, database/domain/integration clients or lifecycle scripts.      |

[Packaging tool](../tools/contract-artifact.mjs) compiles an isolated Git archive, using matching installed backend compiler/Zod files without building or writing the backend. Only distribution packaging/compiler-output settings change; schema/helper source remains exact. The positive npm file allowlist is checked against actual archive contents. Rebuilding the same revision reproduced the same tarball digest, including after pinning LF; differing existing artifacts are refused rather than silently overwritten.

After `npm ci`, run `npm run contracts:check`. It verifies archive SHA-256/SHA-512, member allowlist, installed file hashes, Zod/export identity, pure module imports/capabilities, source/map consistency and staff origin boundaries. It requires no sibling checkout. Static inspection is an engineering guard, not a JavaScript sandbox/security certification.

For an explicitly reviewed refresh, use `npm run contracts:pack -- <backend-root> <full-reviewed-sha>` with matching installed backend tools/dependencies. Review API/source changes, artifact, provenance, map, facade and lockfile together. The tool leaves disposable staging beneath ignored `artifacts.local/f02-01/`. ESLint now explicitly excludes that temporary copied/build output; actual application sources and tooling retain all checks.

The backend artifact retains its exact Zod 4.6.5 dependency; the existing frontend environment validator retains 4.6.7. No override, silent upgrade or cross-version type cast was introduced. Keep packaged schemas and helpers together; package refresh is reviewed work. The lockfile pins both dependency identities.

## Public import boundary

[services/contracts/index.ts](../src/services/contracts/index.ts) explicitly exports the first session/profile/terms/OAuth/error and exact-money helpers/types. Later schemas enter this facade with their actual feature callers; it is not a universal re-export. No route calls, session state, browser storage, Query hooks or provider SDKs are added.

Only that exact facade file may import the root `@darve/contracts` entry. Feature direct imports, another service bypass, deep package paths, private `@darve/*` modules and Node builtins remain rejected. Six added architecture cases verify the narrow exception; eight artifact safety cases verify browser-only dependencies and reject server imports, relative escape, networking/storage and dynamic loading/code. Package root exports also prevent deep module access.

## Wire findings that affect implementation

The matrix/register assign five explicit gaps: normal pending **202** responses are rejected by the old generic helper; several complete staff wire schemas remain inline; support page/SSE contracts need public completion; moderation inputs remain domain-local; and existing overlay consumer reducers only parse v1 despite newer v2 template schemas. They are not silently fixed by copying DTOs or weakening validation. Creator transport can proceed; each affected feature must resolve its specific contract gap before claiming interoperability.

Important source distinctions include bare creator session versus enveloped feature responses; absent logout body/empty 204; backend OAuth callbacks/redirects; intent-dependent creator OAuth CSRF; private guest cookie initialization before a checkout; original idempotency key/terms reconciliation; distinct staff email-code/enrollment/session proofs; source-grant fragment capture and independent cookie; omitted protocol query for v1 versus explicit `protocolVersion=2`. No frontend-managed password submission, automatic pending-to-success conversion or fabricated receipt is supplied.

Cache keys/generation isolation in the matrix are requirements for F02-02, not a working implementation. Realtime parsing/reconnect/version/freshness behavior remains F02-03. Resend is still the selected backend email provider; this task configures no sender or real delivery.

## Verification

- Contract artifact checks passed with 52 exact files and 205 runtime exports. Packaging reproduced the same digest. The operation register has no duplicate endpoint/ID or unknown public-schema reference and binds staff operations to the staff origin.
- An independent temporary consumer outside this repository installed the committed tarball and exact Zod dependency **offline** from cache. Its resolved package stayed inside that independent install. The entire public entry bundled for a browser and ran in Chromium: all 205 exports loaded, the actual bare signed-out session parsed, large exact money stayed intact, and the existing 202 protocol-error limitation was observed. No sibling backend package was required. This is package/browser compatibility, not API or provider acceptance.
- Typed lint, TypeScript/production build, architecture (31 cases), artifact safety (8 cases) and unit/component (14 cases) qualification include the new boundary and three pinned-consumer checks. They prove bare session versus invented envelope, empty 204/explicit 202 limitation and exact minor-unit conversion without hidden rounding. Full installed pre-push and current-head light CI qualify the task PR separately.
- All 22 existing product/component desktop/mobile browser cases passed on the settled source/build with zero retries. No backend server was started and no live API request was used as evidence for this mapping task. Current-head checks/integration identities belong to the task PR.

Initial packaging rejected npm's automatically included README; it was reviewed and explicitly allowlisted. An initial map ID collision between two member-change routes was corrected to unique origin/method/path identity. Temporary backend copies were incorrectly picked up by project lint and now have their exact disposable cache exclusion. The Windows Git-hook PATH selected GNU tar, which treats a drive colon as a remote host; relative archive paths remove that ambiguity without changing the artifact. Those failed intermediate states do not qualify the final artifact or weaken application architecture.

## User preview and restart

The user requested an interactive preview. Vite was started on loopback **5173** and the component fixture was verified in Chromium, including opening its native dialog. Open `http://127.0.0.1:5173/tests/fixtures/primitives.html`; `/` shows the unconnected product foundation. The 5173 server is intentionally left running for the user; it is a local source preview and serves no backend business actions. Recheck its port/process before reusing/stopping it. If absent, run `npm run dev` from the frontend repository. No transferable tool session is required.

The independent package probe's 5188 server/browser and test-owned 4173/4175 servers are stopped after checks. Local evidence/staging is under ignored `artifacts.local/f02-01/`; committed sources/artifact/map/tests reproduce the qualified result. Preserve unrelated backend documentation edits.

Next: F02-02 origin-bound Fetch transport, actual creator session/CSRF and authority-generation/cache fences, explicit 202/204/redirect handling, safe errors and isolated local backend configuration. F02-03 follows for realtime. Staff/support/overlay-v2 public-contract gaps retain their corresponding backend/feature owners. Deployment, real provider/mail/payment activation and original source folders remain outside this task.
