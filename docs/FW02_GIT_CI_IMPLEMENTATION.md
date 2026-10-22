# FW-02 tiered Git and frontend CI

Authorized 2026-10-22: follow backend task PR → dev/light validation and dev → main/full acceptance, adapted to frontend tests. The founder supplied `https://github.com/leonidboskoski03/darve-frontend.git`. Inspection found an empty repository; no existing remote source is discarded. `origin` points there.

## Source and scope

Branch: `chore/frontend-tiered-ci`, based on documentation descendant `8ee04a3`, preserving F00 `ffc472d`. The unpublished docs branch is a dependency, not a reason to reset to old dev. Bootstrap remote dev from F00, then review documentation/CI through a task PR. Stable main/product deployment is not established by bootstrap.

Changes: separate dev/release/source-record workflows, fail-closed diff/source policy, regression cases, package scripts, PR template and delivery docs. Runtime app and backend code/data are unchanged; no dependency package is added. Pre-push remains the full local hook.

## Checklist

- [x] Inspect backend branch/job/protection policy and current frontend state.
- [x] Implement light dev/docs-only and full release/source-record definitions.
- [x] Test complete Git merge diffs, rename/deletion and source-policy boundaries locally.
- [x] Complete settled local checks and browser acceptance after tooling changes.
- [ ] Bootstrap remote dev, publish task PR and configure/read back available dev controls.
- [ ] Verify current-head hosted development acceptance and authorized integration/cleanup.
- [ ] Establish main protection and first full hosted release proof at the first authorized stable release; do not claim deployment.

## Verification and restart

Ten initial policy cases pass, including independent real Git fixtures. First lint flagged an explicit throw in fixture cleanup's finally block; cleanup was extracted into a checked helper without disabling lint or weakening its path guard. Settled local `npm run check` passes: formatting, typed lint, 116 local links across 21 documents, one production build/typecheck, 25 architecture cases, ten CI-policy cases and four component/config cases. All six desktop/mobile Playwright cases pass (3.2 seconds); dependency audit reports zero findings. Hosted setup/results remain pending.

No real provider/mail/payment acceptance, main release or deployment belongs to FW-02. F01/F02 remain separate. [Git/CI](GIT_AND_CI_SETUP.md) and [batch delivery](BATCH_DELIVERY.md) own the ongoing process.
