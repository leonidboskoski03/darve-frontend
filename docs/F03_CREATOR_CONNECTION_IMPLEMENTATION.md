# F03 landing and creator connection

Started 2026-10-27 from clean synchronized dev `0d20e8e1f9af19ddc845bcd8dc7d1d449af189fc` on `feat/f03-creator-connection`. User authorized the next work and comparison with `darve-stream-standalone-main`. Backend/contracts remain `e12b84de3959f6fdbd7eba04ffdfa135f6ba47aa`; preserve its three existing documentation edits, ordinary storage and historical sources. [PLAN](PLAN.md) owns batch acceptance and the [tracker](FRONTEND_TASK_TRACKER.md) owns statuses.

## Bounded delivery

- F03-01: rebuild the selected standalone landing, accessible navigation and three-provider connection entry. Preserve the magenta/Inter identity, two-line headline, starfield, illustrative dashboard and compact footer; compare desktop/phone rendering with the source and supplied screenshot.
- F03-02: actual creator session/return states, current server terms/version/hash acceptance and existing connection/purpose management. Preserve backend identity/streaming/bot separation and explicit user choice. No browser scopes/tokens, fake login, optimistic connection success, fabricated policy copy or automatic unlink/replay.
- F03-03: local browser/API qualification, expiry/denial/conflict/uncertainty and source/asset-preservation proof. Provider-account consent and actual external OAuth exchange remain separate evidence; missing provider/terms configuration must be visible and cannot be called success.

The standalone onboarding is a visual reference, not the current workflow: it assumes Twitch/Stripe, immediate OBS setup and old legal/fee copy. F03 uses actual three-provider API/session/terms/capability state. Payment/OBS issuance and collection/pin confirmation remain with their feature owners; this page cannot grant or imply those permissions automatically.

## Source checkpoint

Selected standalone files: `app/templates/landing.html` SHA-256 `6535877c41afbdccb859aaa8fd38e4cb8d7a9cac9a67e644491fcd178d3853d0`; `app/templates/pages/onboarding.html` `d11db6fa6ec52b94c93d998ddff05bc5e2b932adc4a815821b2ab1320250917d`; `app/templates/components/starfield_bg.html` `f1be2d86e8190bbd9f75cd0c6db52f601fb37ca8f7acd2abd710e9f0b4676a95`; `app/templates/components/twitch_login_button.html` `c065db6e13080a740f480039f97240a92369a81d02fab4f70898643a2f358b11`. The [F01 landing capture](assets/f01/Landing.png) was visually inspected. Existing F authorization/integration grouping was also checked; its fake toggles, browser-built scopes and clip promises are excluded.

## Implemented journey

`/` now renders the selected standalone landing; `/authorize` offers Twitch, YouTube and Kick equally. `/integrations` inspects the actual creator session, requires current terms where necessary, then loads the server's paginated connections. `/terms` reviews the current authenticated account document. With no public API origin, provider buttons are disabled with an explicit explanation. Unknown routes retain the existing error page. The menu's Account terms link is not a fabricated public legal policy.

Routes compose the session and creator-access features; neither feature imports its sibling. `services/creator-access` validates the pinned schemas, provider destinations and document/connection inputs. It consumes authorization URLs internally and navigates once; those URLs never enter React state, Query, browser storage or evidence. Only the provider's exact HTTPS authorization origin/path is allowed. The backend owns scopes, state, PKCE, browser proof, callback exchange and credentials. The browser always requests the allowed return path `/integrations` and never exchanges a code. Expired responses, overlapping starts and late prior-authority responses are rejected. Successful navigation initiation keeps the attempt locked until unload.

Creator writes use the in-memory session CSRF proof. Importantly, an existing session also requires CSRF on `sign_in`; only an anonymous sign-in start can omit it. Callback hints are display-only: bootstrap removes secret/unknown return fields before constructing the router, then the actual session determines access. A success query cannot sign a user in. Session loading, expiry, unavailable and unconfirmed logout hide private data. Scope rotation cancels queries and remounts private state using the existing F02 boundary.

The terms view renders the exact server content as text, with development classification visible. Consent starts unchecked and submits the exact document ID/version/hash. A changed document resets consent, refreshes the document and requires a new deliberate action. Network uncertainty offers an authoritative session check; mutations never automatically replay. Acceptance survives reload through persisted server state, not browser storage.

Connections retain capability/reason distinctions and pagination. Partial pages cannot falsely claim a provider is disconnected. Identity reconnect, chat-reading authorization and explicit Twitch DarveBot destination consent are separate operations. None permits replacing a pin; that remains a separate per-collection choice in F04. Disconnect confirms the reviewed version, refreshes on conflict and reinspects the session after 204 because unlink can end it. Provider/account text is rendered as text. No optimistic connection, permission or funding success is invented.

## Standalone comparison and visual proof

Preserved the original logo/local Inter, dark background, two-line heading, magenta pill, three feature labels, wordless dashboard illustration, compact menu/footer and source social destinations. Intentional changes: the CTA opens a three-provider chooser; the large magenta heading uses an accessible semantic heading color; the viewer word is stable; the starfield is a deterministic decorative SVG rather than an endless particle loop. Existing scoped entrance motion respects reduced motion. Phone and zoom layouts scroll naturally rather than clipping the original fixed viewport.

Public, offline captures contain no account or authorization material:

- [Desktop landing](assets/f03/landing-desktop.png), compared with the [F01 standalone reference](assets/f01/Landing.png).
- [Phone landing](assets/f03/landing-phone.png).
- [Unconfigured phone entry](assets/f03/authorize-unconfigured-phone.png).

Browser inspection at 1440×960, 390×844 and 320×720 found no document horizontal overflow or page errors. Desktop/390 layouts fit their viewport; 320 scrolls vertically. Keyboard menu dismissal restores focus; existing reduced-motion and accessibility cases are retained. Captures establish presentation, not provider acceptance or measured production Web Vitals.

## Local acceptance and limits

`npm run test:creator:local -- ../darve-backend` passed nine actual browser/API checks against the pinned backend, real disposable PostgreSQL/Redis and all 60 fresh migrations. It verified unavailable starts for all three providers, actual terms content, incorrect-CSRF denial, changed-policy conflict/reset, persisted acceptance and empty connection state, reload/review, guest separation plus forged callback hints, missing policy denial and actual SQL logout revocation. The Node-only synthetic identity/session fixture is explicitly labelled; it is not an external identity verification or product login shortcut. No provider credential or external consent was used. See the [local runbook](LOCAL_API_COMPOSITION.md).

Focused boundary tests passed 23 new cases, including destination validation, authenticated sign-in CSRF, overlap/late authority/expiry handling, terms and unlink. Focused desktop/phone browser checks passed 24 cases, including the retained landing cases and 18 new creator cases. Browser provider-navigation tests intercept explicitly synthetic contract responses and approved destinations; they do not contact providers. The final settled `npm run check` passed: formatting, typed lint/import rules, documentation links, unchanged artifact verification, production types/build, 31 architecture cases, 8 artifact-safety cases, 10 CI-policy cases and 117 unit/component tests. The full `npm run test:e2e` passed all 48 desktop/mobile cases against that build (21.2 seconds). No retries were configured. Safe logs: `artifacts.local/f03/full-check.log` and `browser-check.log`. The build keeps creator routes/API contracts in conditional chunks; no browser performance metric is inferred from bundle size.

Resolved setup failures: the installed Lucide release has no provider brand icons, so local SVG marks are used; Fast Refresh constants/helpers were separated; Vite's fixture configuration uses `envDir: false`; the router supplies an initial fallback. The actual changed-policy fixture initially reused an Express rate-limit store during server restart; recreating owned dependencies fixed the warning and the second nine-check run passed. A nonfatal backend `pg` notice about concurrent client queries remains outside frontend scope; no backend source was changed to suppress it.

F03 engineering/local qualification and actual external acceptance are distinct. The batch remains IN_PROGRESS until configured provider callbacks and account consent prove actual Twitch/YouTube/Kick exchanges, returned session/connection state and purpose-specific grants. Current provider configuration, real account consent and a reviewed actual policy must be supplied in that environment. This does not authorize deployment or invent a public legal policy. Receiving readiness, OBS issuance and per-round pin confirmation remain F06/F07/F04 respectively.

## Restart and integration checkpoint

Resumed 2026-10-29, Europe/Warsaw. Branch `feat/f03-creator-connection`, base `0d20e8e1f9af19ddc845bcd8dc7d1d449af189fc`; the settled implementation and final evidence are ready for the focused commit/PR. Contracts remain the unchanged pinned artifact; only four reviewed connection schemas were added to the facade. No dependency/lockfile update. The four historical source hashes and pinned backend HEAD were rechecked unchanged on resume; its only tracked changes remain the same three pre-existing documentation edits.

Actual API proof is in ignored `artifacts.local/f03/acceptance.json`; public visual metadata is `visual-check.json`. The acceptance's API 3310, Vite 4175 and task-labelled tmpfs containers were stopped in `finally`; recheck actual liveness after interruptions. The user's offline Vite preview on loopback 5173 is intentionally retained and now serves the rebuilt public landing. No secrets, provider payloads or private captures belong in Git.

Final source checks and public visual inspection passed on resume. The former preview process had stopped during the interruption; a new hidden Vite process serves the offline landing on 5173, with PID metadata under ignored `preview.json`. API 3310/temporary Vite 4175 have no listener and no F03 containers remain. The 5173 preview is intentionally kept running.

Integration procedure: commit with the staged hooks, push with the required full local pre-push gate, open the focused PR into protected dev, require its current-head light check, then verify integration and branch cleanup. GitHub PR/history identifies the final candidate and merge SHA; ignored `artifacts.local/f03/pr.json` records exact integration metadata locally. Keep main/deployment unchanged. External provider acceptance remains F03-AC-01; the next product work is F04 after this integration.
