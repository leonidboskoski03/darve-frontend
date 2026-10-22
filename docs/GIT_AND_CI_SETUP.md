# Git and CI setup

## Actual setup

The frontend is a separate Git repository. `dev` was bootstrapped locally with F00 commit `ffc472d`. No frontend remote, hosted protection, published PR or hosted check has been established. This document defines the intended workflow without claiming those controls exist. Recheck actual state on resume.

Husky is installed through `prepare` and `core.hooksPath=.husky/_`. [Pre-commit](../.husky/pre-commit) invokes lint-staged; code gets typed ESLint/Prettier, supported document/config formats get Prettier. [Pre-push](../.husky/pre-push) invokes the full `npm run check`. Hooks do not authorize a release and are not a security boundary; do not disable them to conceal failures.

[The CI definition](../.github/workflows/frontend-checks.yml) runs on PRs targeting dev/main and manual dispatch. It uses Node from `.nvmrc`, lockfile installation, `npm run check`, Chromium installation and all current Playwright projects. Token access is read-only, timeout is 15 minutes, duplicate PR runs are cancelled and synthetic failure reports have three-day retention. There is no automatic deployment or backend/provider secret requirement in this pipeline. It currently has no docs-only fast path; describe optimizations as future tooling work until implemented.

## Development flow

1. Inspect status, branch/HEAD, remote/upstream and worktrees. Preserve uncommitted/unpublished work and required dependency commits.
2. Create a focused branch from the appropriate current dev baseline: `feat/f01-design-system`, `fix/f06-receipt-expiry` or `docs/frontend-workflow`, for example. Names are examples, not existing branches.
3. Make reviewable commits with problem/result, acceptance and limitations in the owning record. Docs-only work needs the workflow's Markdown checks; configured hooks/CI still apply.
4. Once a frontend remote is explicitly established, publish task branches and review PRs into protected dev. Configure required current-head quality checks/review policy on the remote; a checked-in workflow does not create protection.
5. Merge only under the authorized review process after required current-head checks and local evidence pass. Do not treat a task request as permission to deploy or rewrite dependent history.

Until a remote exists, preserve local commits/branches for review and state publication as pending. Do not invent a GitHub repository name, push to the backend remote, silently establish branch protection or locally merge away a review branch simply to present a clean dev branch.

## Task branch cleanup

After verified integration, confirm the task source is an ancestor of the intended dev result and no unique unfinished work/worktree depends on it. Preserve required untracked/ignored artifacts, return to settled dev and delete only the integrated temporary local branch without force. Remote cleanup is coordinated with actual repository settings; automatic deletion has not been configured here. Keep dev/main and deliberate backup refs. A failed ancestry check is a reason to inspect, never force deletion.

## Release and deployment

At an authorized release checkpoint, prepare dev → main with exact frontend/backend compatibility, public contract source/digest, lockfile, build artifact identity and environment. Run current local/hosted checks plus required connected acceptance. Main does not yet exist in this local bootstrap; establish release branches/protections through reviewed repository setup when needed.

Record every required check against the final unchanged candidate. Hosted frontend checks do not prove real mail/provider/payment/OBS behavior or safe backend migrations. Keep those acceptance owners/evidence explicit. Deployment must satisfy the [deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md) and obtain its own scope. Frontend rollback cannot reverse payments, coin commands or database changes.
