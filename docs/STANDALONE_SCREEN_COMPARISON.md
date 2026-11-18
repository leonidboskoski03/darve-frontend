# Standalone screen comparison

The founder selected the historical standalone appearance. This audit covers every one of its 40 Askama templates and 43 rendered pages, states and interaction shells (86 desktop/mobile source captures). The original source is the local archive at `../darve-stream-standalone-main/app/templates`; it has no Git metadata. SHA-256 hashes are recorded in the local comparison manifest. No original template was edited.

## Review artifacts

Open `artifacts.local/standalone-audit/index.html` for source / earlier rebuild / current rebuild comparisons. The folder also contains generated original HTML, all source PNGs, rebuilt PNGs, `standalone-manifest.json` and `comparison-manifest.json` (including every source template hash). Artifacts use reference/synthetic data and remain Git-ignored. Source captures are 1440×1000 and 390×844 viewports, with full-page scrolling. Rebuilt captures use the existing desktop/mobile acceptance devices; overlay capture uses broadcast dimensions. Different data and viewport sizes make these visual comparisons, not pixel equality tests.

The source was rendered by its real Rust/Askama view types in a temporary builder container, with local fixture composition for HTMX fragments. Finite entrance animations were completed before capture. Network calls outside localhost were blocked; source QR pixels were generated locally for the fixture URL. Empty overlay states are intentionally transparent. The recording dialog captures its shell without invented footage.

## Screen and state mapping

| Original screen/state | Current destination                                | Comparison and decision                                                                                                                                            |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| account-menu          | `Creator shell account menu`                       | My profile / Support / Sign out implemented. Both menus captured; Escape, focus return and navigation browser-covered.                                             |
| activity-empty        | `/dashboard → Reports and recent activity`         | Current report projection omits donor-level personal details.                                                                                                      |
| challenge-completed   | `/challenges/:challengeId`                         | Current reviewed declaration replaces implicit historical completion.                                                                                              |
| challenge-filter      | `/challenges and /collection/:roundId/suggestions` | Current URL filters and review tabs replace the old collected/past dropdown.                                                                                       |
| challenge-funding     | `/challenges/:challengeId`                         | Current funding/performance distinction and deadline retained.                                                                                                     |
| challenge-history     | `/challenges`                                      | Current history list retains filters and exact funding states; source used an embedded table.                                                                      |
| challenges-collected  | `/collection/:roundId/suggestions`                 | Aligned avatar/content/actions and safe acceptance review; exact amount/currency/credits preserved.                                                                |
| challenges-empty      | `/challenges`                                      | Current empty-history state; source collected queue maps separately to suggestion review.                                                                          |
| collection-active     | `/collection/:roundId`                             | Magenta timer and shared controls; current round facts retained.                                                                                                   |
| collection-blocked    | `/collection`                                      | Current capability/reason handling replaces the static active-challenge block.                                                                                     |
| collection-delay      | `/collection/:roundId`                             | Nearest current state is preparing. Source five-second cooldown has no exact contract equivalent.                                                                  |
| collection-idle       | `/collection`                                      | Multi-provider selection and readiness are required before start.                                                                                                  |
| collection-messages   | `/collection/:roundId/suggestions`                 | Magenta initial avatars, consistent rows, real contributor credits. Raw live chat feed is not exposed by the current projection.                                   |
| collection-offline    | `/collection`                                      | Live availability comes from authoritative stream discovery; no forced ready state.                                                                                |
| dashboard-connected   | `/dashboard`                                       | Dashboard-only sidebar, account menu, collection/OBS columns, full-width Challenges. Current capture uses a different synthetic receiving/round state.             |
| dashboard-unconnected | `/dashboard → /account/payments`                   | Receiving banner and current provider setup. Source inline Twitch-only collection remains an adapted route to current multi-provider workflow.                     |
| donate-closed         | `/contribute/:publicId`                            | Server-owned closed state; no enabled checkout when funding is closed.                                                                                             |
| donate-empty          | `/contribute/:publicId`                            | Restricted projection hides creator identity and content; avoids leaking data to imitate the old empty state.                                                      |
| donate                | `/contribute/:publicId`                            | Magenta rail, centered compact creator identity, light form and local policy footer. Exact funding/availability fields remain visible.                             |
| faq                   | `/faq`                                             | Added the nine original questions locally; shared single-open, keyboard-accessible disclosure. Current-product guidance remains /help.                             |
| landing               | `/welcome`                                         | Standalone headline, logo, magenta CTA and illustration; reduced-motion static copy.                                                                               |
| login                 | `/authorize`                                       | Three functional provider choices replace the old Twitch-only entry.                                                                                               |
| obs-setup             | `/obs`                                             | Centered bordered dark sections; private-link mint/revoke, source and appearance settings retained.                                                                |
| onboarding-1          | `/onboarding`                                      | Guided terms/accounts/payouts/OBS steps replace obsolete welcome-first sequence.                                                                                   |
| onboarding-2          | `/onboarding → /obs`                               | Current private display-grant controls replace the static reusable source URL.                                                                                     |
| onboarding-3          | `/onboarding → /account/payments`                  | Stripe and PayPal retain real readiness checks and explicit authorization.                                                                                         |
| onboarding-4          | `/terms`                                           | Current server document/version/hash consent; old clip promise is not reenacted.                                                                                   |
| onboarding-5          | `/onboarding → /dashboard`                         | Back/Continue navigation; no fabricated completed provider steps.                                                                                                  |
| overlay-choosing      | `/overlay/:displayId`                              | No choosing presentation in current overlay contract. Requires a scoped backend handoff; not fabricated.                                                           |
| overlay-collection    | `/overlay/:displayId`                              | No collection-countdown presentation in current overlay contract. Requires a scoped backend handoff.                                                               |
| overlay-empty         | `/overlay/:displayId`                              | Intentionally empty; current renderer also withdraws stale/invalid content.                                                                                        |
| overlay-funded        | `/overlay/:displayId`                              | Existing selected standalone-compatible broadcast renderer; isolated crop shown at broadcast scale. QR uses synthetic public URL.                                  |
| overlay-shell         | `/overlay/:displayId`                              | Intentionally transparent until a validated private grant and fresh selected presentation exist.                                                                   |
| privacy               | `/privacy`                                         | Added read-only original policy snapshot with provenance and date. Production applicability remains D02/F03-G02.                                                   |
| profile-connected     | `/account`                                         | Centered identity card and aligned settings rows. API currently supplies display name; provider handle/avatar are F03-G01.                                         |
| profile-unconnected   | `/account → /account/payments`                     | Same profile structure; receiving readiness remains authoritative and separate.                                                                                    |
| receiving-unavailable | `/account/payments`                                | Configuration and failure states retained; cannot manufacture provider availability.                                                                               |
| recording-dialog      | `No current clip playback contract`                | Source empty video-dialog shell captured. Clip delivery/playback requires current product/backend ownership; no dummy recording.                                   |
| safety                | `/safety`                                          | Added read-only original policy snapshot.                                                                                                                          |
| session-expired       | `/authorize`                                       | Existing session boundary clears private content and returns to sign-in. Source Twitch-only modal is not reused; expiry behavior covered by creator browser tests. |
| support               | `/support`                                         | Narrowed list/compose area; durable tickets replace original email-only form.                                                                                      |
| terms                 | `/legal/terms`                                     | Added read-only original Terms. Authenticated /terms still owns exact server consent.                                                                              |
| workspace-navigation  | `Creator shell navigation`                         | Desktop Dashboard-only sidebar; extra current routes remain reachable in navigation dialog. Mobile source sidebar differs from rebuilt accessible dialog.          |

## Template coverage

Every source template is represented directly or composed into the listed screen family. Shared layout, brand, timer and starfield fragments are dependencies, not invented product routes. The manifest records full hashes for repeatable comparison.

| Template                                     | SHA-256 prefix | Captured owner                      |
| -------------------------------------------- | -------------- | ----------------------------------- |
| `base.html`                                  | `2fc2a16a5fd5` | Shared public / creator shell       |
| `components/activity_table.html`             | `30ec82f6c064` | Activity empty / dashboard          |
| `components/collection_active_panel.html`    | `c5dffda7f1ae` | Collection states / dashboard       |
| `components/collection_delay_panel.html`     | `506966c28ba7` | Collection states / dashboard       |
| `components/collection_inactive_panel.html`  | `7ddf14765be4` | Collection states / dashboard       |
| `components/collection_messages.html`        | `712a8e2ec156` | Collection states / dashboard       |
| `components/collection_offline_panel.html`   | `d279a0bd21f3` | Collection states / dashboard       |
| `components/collection_timer_ring.html`      | `8b4916f5c264` | Collection states / dashboard       |
| `components/copy_overlay_link.html`          | `05984e4c4960` | OBS setup / overlay states          |
| `components/dashboard_challenges.html`       | `fcdf919e7599` | Challenge queue / review / history  |
| `components/dashboard_overlay.html`          | `fd0d81230b54` | OBS setup / overlay states          |
| `components/dashboard_start_collection.html` | `0b8e084f4b49` | Collection states / dashboard       |
| `components/live_task_card.html`             | `13adc9de9bcd` | components/live_task_card.html      |
| `components/logo.html`                       | `86606a1edb8d` | Shared public / creator shell       |
| `components/overlay_choosing.html`           | `6be21d729fe0` | OBS setup / overlay states          |
| `components/overlay_collection.html`         | `4f72b87ac891` | OBS setup / overlay states          |
| `components/overlay_content.html`            | `98bb550391df` | OBS setup / overlay states          |
| `components/overlay_empty.html`              | `e3b0c44298fc` | OBS setup / overlay states          |
| `components/past_challenges.html`            | `0abaa39153a0` | Challenge queue / review / history  |
| `components/relogin_modal.html`              | `6e7c0b1f9b9b` | Session expired                     |
| `components/starfield_bg.html`               | `f1be2d86e819` | Shared public / creator shell       |
| `components/submissions_list.html`           | `8ec84551b4d2` | Challenge queue / review / history  |
| `components/submission_row.html`             | `c194bd26dc91` | Challenge queue / review / history  |
| `components/time_countdown.html`             | `0f30cdb08d31` | Collection / challenge states       |
| `components/twitch_login_button.html`        | `c065db6e1308` | components/twitch_login_button.html |
| `landing.html`                               | `6535877c41af` | landing.html                        |
| `layout.html`                                | `3bc30809878a` | Shared public / creator shell       |
| `login.html`                                 | `a9804b045aa9` | login.html                          |
| `overlay.html`                               | `af3a7bc22416` | OBS setup / overlay states          |
| `pages/dashboard.html`                       | `deb866955938` | pages/dashboard.html                |
| `pages/donate.html`                          | `4d1c743b88c5` | pages/donate.html                   |
| `pages/donate_no_challenge.html`             | `94385f169210` | Challenge queue / review / history  |
| `pages/faq.html`                             | `c0605fdb96f2` | pages/faq.html                      |
| `pages/no_stripe.html`                       | `abeb5121da65` | pages/no_stripe.html                |
| `pages/onboarding.html`                      | `d11db6fa6ec5` | pages/onboarding.html               |
| `pages/privacy.html`                         | `ced6c5c2c637` | pages/privacy.html                  |
| `pages/profile.html`                         | `1e3c5c689ed1` | pages/profile.html                  |
| `pages/safety.html`                          | `2d47aca8ea50` | pages/safety.html                   |
| `pages/support.html`                         | `f65d8551fc38` | pages/support.html                  |
| `pages/terms.html`                           | `4e4c6e1c0a66` | pages/terms.html                    |

## Implemented changes and boundaries

Shared shell/dashboard/profile/setup/support use the standalone proportions and magenta styling. This pass extends semantic magenta to collection and review, aligns suggestion avatars/actions, narrows OBS settings into consistent bordered sections, and makes contribution identity compact and centered with local policy navigation. Public FAQ and read-only Terms/Privacy/Safety now render from the archived standalone content through a whitelisted content tree. No raw policy HTML is injected. Public snapshots are distinct from current authenticated consent. F03-G02/D02 retain production applicability/version approval.

The current richer identity projection, collection countdown/choosing overlay frames and recording playback remain explicit contract/input gaps. Current exact money, independent funding/performance state, three-provider authorization, readiness, private OBS grants, durable support and privacy restrictions remain authoritative. Styling does not qualify a live provider/payment/OBS session. The backend checkout and persistent development/staging stacks were not changed.

## Validation and handoff

Frontend branch `codex/frontend-manual-testing` starts at `67280bc`; changes remain local and uncommitted together with prior authorized frontend work. Initial browser sweep: 159 passed, one navigation timeout; the timed-out case passed in a focused rerun (six cases passed including contribution screenshots). The final full `npm run check` passed (440 unit/component cases, 49 operator cases, architecture/contracts/CI rules, lint, docs and production builds). Final focused browser runs passed 114 cases across contributions, creator authorization boundaries, landing, support and OBS, plus all 14 core walkthrough cases. The initial sweep also passed the new eight public FAQ/policy cases and collection/review/reporting checks. The build retains its existing staff bundle-size warning. Temporary screenshot and acceptance servers stop after their runs. No connected product profile or application database was started for this audit.
