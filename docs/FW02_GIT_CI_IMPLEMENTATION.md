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
- [x] Bootstrap remote dev, publish task PR and configure/read back dev and future main controls.
- [x] Verify current-head hosted code-development acceptance and protected integration/cleanup.
- [x] Configure and read back active future main rules without creating a fake stable/deployed branch.

## Verification and restart

Ten initial policy cases pass, including independent real Git fixtures. First lint flagged an explicit throw in fixture cleanup's finally block; cleanup was extracted into a checked helper without disabling lint or weakening its path guard. Settled local `npm run check` passes: formatting, typed lint, 116 local links across 21 documents, one production build/typecheck, 25 architecture cases, ten CI-policy cases and four component/config cases. All six desktop/mobile Playwright cases pass (3.2 seconds); dependency audit reports zero findings. [PR #1](https://github.com/leonidboskoski03/darve-frontend/pull/1) passed hosted `development-checks` on implementation head `acad8aa02ad7cc5af4dd36d3083ce8a7813832c5` ([job](https://github.com/leonidboskoski03/darve-frontend/actions/runs/39847802582/job/120065636688)) and merged as `a38ac359becdfbbe96ea651ebbef9b81753187a3`. Both F00 and documentation ancestor `8ee04a3` are retained; local task/documentation branches were normally deleted after ancestry/worktree checks.

No real provider/mail/payment acceptance, main release or deployment belongs to FW-02. F01/F02 remain separate. [Git/CI](GIT_AND_CI_SETUP.md) and [batch delivery](BATCH_DELIVERY.md) own the ongoing process.

## Remote controls and scope limits

Read-back confirms default dev, required up-to-date GitHub Actions `development-checks` (app 15368), PRs for administrators, zero mandatory outside approvals, no force push/deletion, merge commits and automatic merged-branch deletion. Active main ruleset `25673604` targets `refs/heads/main` with no bypass actors, PR/merge requirements, no deletion/force push and current app-bound `release-policy` plus `frontend-acceptance`. GitHub returns these effective rules even though main does not yet exist. Initial settings requests before the bootstrap push completed were rejected; setup was retried only after refs were present, without bypassing protection.

A docs-only follow-up through `docs/fw02-hosted-closure` records this evidence and exercises the separate prose-only hosted path. Its exact check/merge result is retained in PR history and must pass the protected dev gate before integration. This is documentation evidence, not a new application candidate or a reason to repeat provider tests.

## Deferred release proof — F11

The first stable main branch/release and full hosted release-policy/frontend-acceptance exercise remain with F11 at an authorized stable checkpoint. Definitions and local policy/complete frontend tests pass; this is not a claim that the full hosted release workflow or deployed operation has been exercised. The future main rules are already active. No main push, deployment, tag or live-provider action was performed by FW-02.
