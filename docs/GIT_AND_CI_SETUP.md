# Git and CI setup

## Branch roles and current setup

Confirmed 2026-10-22: use the backend's two-branch model. `dev` is the development/integration baseline; `main` is stable release source for the deployed product. A deployment record identifies the actual deployed commit: a branch name alone never proves deployment. No extra permanent staging/QA branch is needed.

The selected remote is `https://github.com/leonidboskoski03/darve-frontend.git`. It was empty when inspected. Local dev started with F00 `ffc472d`; documentation descendant `8ee04a3` is preserved by the workflow task. Actual bootstrap, protection, PR/check and cleanup evidence belongs to [FW02_GIT_CI_IMPLEMENTATION](FW02_GIT_CI_IMPLEMENTATION.md). Do not assume pending setup has passed. Stable main/release/deployment remains separate from bootstrap.

## Development PRs

Create focused task branches from current dev, preserving unpublished dependencies and unrelated work. Open PRs against dev; do not use main for routine tasks or commit every feature directly to dev. Prefer merge commits when preserving dependent ancestry. Squash only independent work with no published dependent history.

[Development CI](../.github/workflows/development-checks.yml) requires the distinct **development-checks** job:

- Code/config/tooling: formatting, typed lint/import architecture, links, one build/typecheck. No hosted unit/component/browser suites, audit or Docker images.
- Docs-only: formatting and links. The complete PR merge-tree diff must contain only root Markdown, `docs/**/*.md` or `.github/pull_request_template.md`. Include deletions and both rename sides; empty/unreadable diffs cannot silently use this shortcut.

Workflows include PR base-edit events so retargeting cannot reuse the wrong tier. Ordinary task/dev pushes do not duplicate PR CI. Batch settled pushes and require current-head checks. Relevant local tests/browser/backend acceptance remain mandatory under [WORKFLOW](WORKFLOW.md), even when dev CI is light.

## Release, hotfix and deployment

At an authorized coherent working checkpoint, open dev → main. [Release acceptance](../.github/workflows/release-acceptance.yml) requires **release-policy** and **frontend-acceptance**. Only this repository's dev or nonempty hotfix/* source can release; direct task branches/forks cannot. Manual full acceptance is allowed on dev/main/hotfix/* and never merges or deploys.

Full acceptance runs formatting, lint/boundaries, types/build, architecture/CI-policy cases, unit/component tests, links, dependency audit and all current Playwright desktop/mobile/accessibility cases against that production build on Linux. No backend SQL/Docker checks are invented for the frontend. Add appropriate reproducible isolated backend/browser cases as integration is implemented; retain separate real provider/mail/physical QR/OBS evidence.

Hotfixes branch from stable main, get focused local proof and full main-targeted CI, then synchronize back into dev through a light PR. Synchronize main back into dev after releases as needed without resets. Keep the final candidate unchanged during checks; previous green runs, completed tracker rows and skipped suites cannot substitute for current acceptance.

[Stable source recording](../.github/workflows/stable-release-record.yml) runs only on main pushes and records commit/tree identity. It does not repeat tests, tag, publish or deploy. Deployment must pin approved source/artifacts and satisfy the [deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md).

## Protections and hooks

Set dev as default integration branch and require up-to-date `development-checks` and PRs, including administrators. Require current `release-policy` and `frontend-acceptance` on main before release use. Protect both from force pushes/deletion and bind checks to the GitHub Actions app. The solo setup can retain zero mandatory outside approvals while keeping PR diff review. Enable merge commits and automatic deletion of merged temporary source branches. Actual remote read-back belongs to FW-02, not a YAML assumption.

Husky installs `core.hooksPath=.husky/_`. [Pre-commit](../.husky/pre-commit) runs staged lint/format checks. [Pre-push](../.husky/pre-push) retains full local `npm run check`; hosted dev CI is lighter than this hook. Do not disable hooks to hide failures. CI independently repeats its gate; hook optimization is separate reviewed tooling work.

## Branch cleanup

After authorized integration, verify merged target/current-head checks and source ancestry. Inspect worktrees/unique unfinished work and preserve artifacts/backups. Return to current dev by fast-forward, prune deleted remote refs and delete integrated local temporary branches with normal guards. Never force deletion after a failed check or delete dev/main. Automatic remote deletion does not clean local branches; resolve or explicitly retain dependent worktrees/branches.

Until bootstrap completes, preserve the local chain. Do not rewrite F00/documentation history, push to the backend repository or create a fake stable/deployed main merely to match branch names.
