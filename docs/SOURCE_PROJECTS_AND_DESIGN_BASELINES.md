# Source projects and selected design baselines

Owner: F01. This catalogue distinguishes confirmed visual selections from uncompleted screen/component audits. Historical folders are references and must remain intact. The backend's `docs/FRONTEND_BASELINE_COMPARISON.md` supplies the selected F/M/R/A map; current backend contracts supersede old integration behavior.

Paths below are relative to the Darve workspace parent of this repository; they are external references, not frontend dependencies.

| Reference            | Source                                                                               | Selected purpose and evidence limit                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F                    | `darve-stream-frontend-main/src`                                                     | Selected dashboard/creator visual direction. Start with `pages/Dashboard.tsx`, `Collection.tsx`, `Challenges.tsx` and relevant components. Exact full-screen inventory/acceptance remains F01.                        |
| M/R                  | `darve-stream-monorepo-main/frontend/src` and `darve-stream-react-main`              | Selected shared React OBS design. `pages/OverlayRenderer.tsx` and `OverlaySettings.tsx` exist in the corresponding roots. Do not reuse old grant/token/timer assumptions.                                             |
| A                    | `darve-stream-standalone-main/app`                                                   | Selected contribution-page design: `templates/pages/donate.html`; associated templates/assets need bounded F01 review. Old Rust/Stripe behavior is not the current API contract.                                      |
| Screenshot landing   | `darve-stream-standalone-main/app/templates/landing.html`                            | Magenta headline, matching description/footer and rotating “Your Viewers” text. Root template handler and `fly-prod.toml` identify the matching app configuration. Current hosted revision/runtime was not inspected. |
| React landing copies | F `src/pages/Landing.tsx`, M `frontend/src/pages/Landing.tsx`, R `pages/Landing.tsx` | Earlier inspection found identical hashes across these three files, with blue styling/different copy. Not proof that they generated the supplied screenshot.                                                          |
| Other history        | `darve-stream-main`, `darve-server-main`                                             | Selective historical context only; no wholesale social/backend rebuild or extra MVP features.                                                                                                                         |

## F01 inventory requirements

For every actual selected screen, record source path/revision or file hash, chosen design, component reuse, supported responsive sizes, interaction/states, required assets/fonts, real API owner and gaps. Verify screenshots/browser rendering rather than inferring parity from filenames. Record where staff, support, coins and templates lack a selected design and resolve that bounded design work before claiming finished screens.

Retain loading/empty/error/unavailable/offline/expired authority states, keyboard/focus, reduced motion, long text and exact money. Replace old fake API, localStorage tokens, simulated donor/activity timestamps, local authoritative timers and clip actions with current backend behavior. Screen existence is not feature completion.

F00's text mark, system font and simplified foundation layout are temporary engineering presentation, not replacement brand decisions. [DESIGN_AND_MOTION](DESIGN_AND_MOTION.md) owns primitives/motion rules; [PLAN](PLAN.md) owns subsequent delivery scope.
