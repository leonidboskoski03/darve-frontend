# Frontend skeleton and dependency setup

F00 local foundation, established 2026-10-22. Implementation commit: `ffc472d`. This record preserves the foundation evidence for that snapshot; it does not qualify later frontend changes. Current task status belongs to [FRONTEND_TASK_TRACKER](FRONTEND_TASK_TRACKER.md), and current capabilities belong to [CURRENT_STATE](CURRENT_STATE.md).

## F00 implementation and verification

The skeleton implements public routes, providers, preliminary tokens, a foundation preview, safe error handling, public environment validation and shared motion adapters. It intentionally has no real business queries, sessions, guest payments, feature activation or backend contract dependency yet. No historical implementation is copied wholesale.

### Local verification — 2026-10-22

| Check                | Observed result                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reproducible install | `npm ci` succeeds with TLS verification enabled; install reports zero dependency vulnerabilities. Exact versions and lockfile retained.                                                                                                          |
| Complete local gate  | `npm run check` passes: formatting, typed ESLint, 25 architecture regression cases, 16 local documentation links across eight documents, four unit/component cases, TypeScript and production build.                                             |
| Browser acceptance   | Six Chromium cases pass across desktop and Pixel 7 emulation: honest disconnected state, navigation/not-found, keyboard skip/focus, no horizontal overflow, reduced motion and axe automated accessibility checks with zero reported violations. |
| Visual review        | Inspected local 1440×960 and 390×844 screenshots. Foundation content is visible and responsive. These are shell checks, not selected-design or real OBS acceptance.                                                                              |
| Build baseline       | Main JS 430.99 kB / 135.00 kB gzip; lazy home 82.44 / 32.52, lazy motion runtime 47.25 / 18.02, shared SVG helper 3.39 / 1.67, CSS 8.69 / 2.84. These are bundle measurements, not deployed latency or approved production budgets.              |
| Hooks                | Husky installed as `core.hooksPath=.husky/_`; staged ESLint/Prettier run on the initial bootstrap commit. Pre-push invokes the same full check; hosted enforcement is pending.                                                                   |

Initial checks exposed a Windows path-resolution bug in the lint rule and missing Vitest matcher types; both were corrected and the complete gate passed afterward. The first clean-install attempt hit a Windows native-module file lock because the preview process was still running; stopping that owned process and rerunning `npm ci` succeeded. No elevated privileges, TLS bypass or dependency override was used. A provisional 300 kB warning threshold was removed because no product budget has been agreed; actual baseline sizes are recorded above.

No frontend remote, hosted branch protection, published PR, deployment or real provider actions are established. The initial local commit bootstraps `dev`; subsequent work uses focused feature branches. Backend local-first documentation edits from the prior turn remain preserved in the backend checkout; the backend tracker links this foundation without changing backend code or data. Preview/test servers used for verification are stopped.

Next after F00: review the architecture/plan and proceed to F01 reference/component inventory and F02 contract mapping within the authorized next scope. Do not begin every feature simply because it appears in this table.
