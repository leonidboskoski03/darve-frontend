# Frontend development workflow

Adapted from the backend's workflow for the frontend's actual tooling. [ENGINEERING](ENGINEERING.md) defines standards; [ARCHITECTURE](ARCHITECTURE.md) defines module rules. The user's latest authorized scope governs work. A backlog item or source example is not authorization to implement it.

## Read and define the task

1. Read root [AGENTS](../AGENTS.md), [CURRENT_STATE](CURRENT_STATE.md), the relevant [tracker](FRONTEND_TASK_TRACKER.md) row and architecture.
2. Use [the index](README.md) to select only the owning plan/contract/design/security sections and affected code. Read backend owning contracts for integration work, not every backend document or archive.
3. Verify actual implementation and local changes before repeating completed work. Identify deliverable, acceptance, selected design, dependency and external inputs. Distinguish confirmed decisions, proposals, code, local proof and external proof.
4. Explain the intended batch briefly, then work in small reviewable slices. Ask only for unresolved input affecting implementation; continue useful independent work. Do not invent rewards, terms, provider readiness, design selections or successful API outcomes.

## Batches and review units

Follow [BATCH_DELIVERY](BATCH_DELIVERY.md): batches define coherent capabilities, smaller stable tasks are the usual PR/review units, and releases combine compatible integrated work. Keep the next batch concrete and later work at scope/dependency level. A green task PR is not automatically a release or deployment.

## Git and concurrent work

Inspect `git status --short`, branch/HEAD, remotes, upstream and worktrees before editing or switching. Follow [GIT_AND_CI_SETUP](GIT_AND_CI_SETUP.md). New work branches from current dev when that baseline contains the required work; preserve unpublished dependencies and unrelated dirty files. Never reset/clean/force history to match an example. Coordinate different checkouts if two chats would otherwise edit the same files. Do not alter the backend app/data simply because a frontend defect may originate there; record the owning backend issue and authorized remedy.

## Implement and verify narrowly

Keep business UI in features, composition in routes and external adapters in services. Enforce public slice exports and import direction; do not suppress lint. Before API work, populate the relevant [contract row](FRONTEND_API_CONTRACT_MATRIX.md), select the isolated environment and confirm authority/CSRF/idempotency. UI guards and flags never replace API permissions.

Run focused checks while iterating; broaden once the source settles or new failures/dependencies justify it. `npm run check` includes formatting, lint, architecture cases, docs links, unit/component tests, TypeScript and the production build. Do not immediately run another product build afterward without a change. Playwright uses that production build on 4173; rebuild first if application/config/dependencies changed. `test:e2e` additionally builds its four isolated synthetic fixture entries into `dist-acceptance/` and previews that separate static output on 4175. Fixture HTML is excluded from product build entries. Never claim stale dist as acceptance.

Use `npm.cmd`/`npx.cmd` on PowerShell where execution policy requires them. Run commands from the frontend root. Typical focused commands:

```powershell
npm.cmd run test -- src/routes/route-error.test.tsx
npm.cmd run lint
npm.cmd run test:architecture
npm.cmd run build
npm.cmd run test:e2e -- --project=desktop-chromium
```

Do not run install/clean-install against files held by a Vite/test process on Windows. Stop only the owned process, verify its port/session and retry the install; do not terminate unrelated Node/Docker services or request administrator access for a known file lock. Preserve TLS verification.

## Final verification by change

| Change                              | Required local evidence                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown only                       | `npm run docs:check`, Prettier for changed Markdown and `git diff --check`. No app build/test solely for prose.                                                 |
| UI/component/state                  | Focused interaction tests, final `npm run check`; relevant browser/keyboard/reduced-motion/accessibility/visual checks.                                         |
| Architecture/import/tooling         | Relevant negative/positive rule tests, typed lint and full settled local gate; prove new enforcement does not exclude real source.                              |
| API/session/payment/coin adapter    | Boundary tests plus real isolated local backend proof for affected invariants; expiry/denial/resource/replay cases. Full local gate and relevant browser flows. |
| SSE/OBS                             | Reducer/parser/version/freshness/cleanup cases and relevant real stream/browser/OBS evidence. A mock event or rendered QR alone is insufficient.                |
| Environment/packaging/dependencies  | Reproducible install, types/build/affected runtime/browser checks and safe config/lockfile review. Actual hosting/security proof remains later.                 |
| Settled feature integration/release | Current full gate and complete relevant browser/cross-system acceptance; release/hosted gates as documented, with explicit remaining limitations.               |

Hosted dev CI uses `check:docs` for the complete prose allowlist and `check:dev` for other changes; the latter is formatting, lint/import architecture, links and one build/typecheck, without unit/browser suites. Release CI runs `check`, audit and all current Playwright acceptance. The pre-push hook still runs the full local gate. Relevant local feature tests remain mandatory; light hosted checks do not replace them. See [Git/CI](GIT_AND_CI_SETUP.md). Do not push solely to repeat an unchanged check.

## Switching or resuming a chat

Use the [task template](NEW_CHAT_TASK_TEMPLATE.md). Reconstruct context from files and actual Git/runtime state; old tool handles, consent URLs and conversation-only decisions do not transfer reliably.

Leave one restart note in the owning implementation record:

- Authorized task/scope and confirmed decisions.
- Branch/base/HEAD, required dependency commits and dirty files; identify deliberately uncommitted work.
- Current source/contract/environment identity and build freshness.
- Passed/failed/pending checks, observed durations where available, reasons for reruns and safe ignored log paths.
- Owned servers/services/ports, cleanup needed and whether they were stopped. Recheck liveness next time.
- Concrete next action, missing inputs and unresolved verification limits.

Never include tokens, credentials, grant/receipt/consent URLs, private donor/ticket records or raw provider payloads. Replace obsolete restart instructions when work resumes; preserve meaningful failure history. Use a short checklist in the owning record, not another tracker.

## Close and communicate

Update the owning record and tracker once with source identity, acceptance and remaining work. CURRENT_STATE changes only for capability/priority/blocker changes. Update affected rule/contracts/index links when ownership or behavior changes. Detailed logs stay in ignored `test-results/`; summarize relevant failures, not whole environment/log dumps. Close only the verified scope. Publication, hosted checks, sandbox approval, production deployment and live payment activation remain separate claims.

## FW-01 documentation adaptation

Scope: documentation only, based on local frontend foundation `ffc472d`. Branch: `docs/frontend-engineering-workflow`. Reviewed the backend index, workflow, task/current-state/skeleton patterns, restart templates, Git/CI procedure, deployment checklist and source-baseline records. Adapted frontend equivalents and preserved earlier F00 evidence; no runtime source, dependencies, scripts, hooks or CI behavior changed.

The tracker now owns statuses; PLAN owns batch acceptance. FRONTEND_SKELETON owns earlier foundation proof. DEPLOYMENT_PREPARATION_CHECKLIST owns the deferred items formerly in OPERATIONS. The docs index routes contributors and records which backend-only documents should not be copied. New templates distinguish review, one-task implementation and interrupted work. Contract/design catalogues explicitly retain unmapped/unaudited work.

Verification: changed Markdown formatting, repository-local file links and whitespace/diff checks pass. FW-01 is CLOSED for this documentation scope; the Markdown commit hook is also required at commit. Product capability and runtime evidence are unchanged; F01/F02 remain upcoming. At the FW-01 checkpoint no remote was configured; FW-02 owns the subsequent hosted setup. Do not rerun application or provider suites solely for this prose change.
