# New-chat task template

Open the chat against `C:\Users\User\Desktop\Darve\darve-frontend`. Replace `[AUTHORIZED_SCOPE]` with an actual task/subtask ID or explicit batch scope. The [usage guide](NEW_CHAT_TEMPLATE_USAGE_GUIDE.md) explains discussion-only and restart variants. A template cannot recover unpublished files in another checkout, earlier consent or tool sessions; use owning records and verify actual state.

## Implementation prompt

```text
Implement Darve frontend [AUTHORIZED_SCOPE]. This authorizes implementation and verification of that scope only.

Read AGENTS.md, docs/CURRENT_STATE.md, docs/WORKFLOW.md, docs/ARCHITECTURE.md and the relevant docs/FRONTEND_TASK_TRACKER.md rows. Use docs/README.md to find the owning plan, design, API and operations sections; do not load the entire documentation archive.

Inspect actual Git status, branch/base/HEAD, remotes/upstream, required commits, worktrees and existing implementation before editing. Follow docs/GIT_AND_CI_SETUP.md. Preserve unpublished decisions, dirty work and historical source folders. Do not reset, discard or rewrite history to match an old example. The frontend and backend are separate repositories.

Confirm the deliverable, dependencies, current source/design/contract identity and acceptance checks. Distinguish selected designs, finalized contracts, proposals, implemented code and dated verification. Prior test counts are not proof for current changes. Briefly explain the intended slice, then proceed within scope. Ask only for missing decisions affecting the implementation; continue independent work while external inputs remain pending.

Follow the mandatory architecture for every changed module. Routes compose features; entities remain pure; services own external adapters; design-system and motion remain separate. Preserve typed ESLint/import enforcement, public slice entries, accessibility, reduced motion and cleanup. Do not add unrelated libraries/features or suppress checks to finish a task.

Preserve F dashboard, M/R OBS and A contribution direction. Use docs/SOURCE_PROJECTS_AND_DESIGN_BASELINES.md and the current selected references, not old fake API/auth behavior. Backend public contracts and permissions are authoritative. Map affected requests in docs/FRONTEND_API_CONTRACT_MATRIX.md before integration. Never invent endpoints, localStorage tokens, successful funding/coin effects or provider readiness. Creator, staff, guest and overlay authority stay distinct.

Use TanStack Query for server state, React for transient state and URL state for shareable navigation. Reuse version/freshness-aware backend helpers, exact money and resource-specific proof. Keep credentials/private payloads out of code, logs, telemetry, screenshots and documentation. Coordinate actual provider/mail/sandbox actions when needed; mocks do not establish external acceptance.

Work in small reviewable slices with a checklist and restart note in the owning implementation record. Follow WORKFLOW.md for focused checks and required final evidence. Build once after relevant inputs settle; Playwright must consume current dist. Markdown-only changes need format/link/diff checks, while installed hooks/CI still apply. Avoid unchanged full-suite reruns and preserve failures/limitations.

Update the owning record and tracker once. Update CURRENT_STATE.md only when capabilities, priorities or blockers change. Update affected contracts/index links when behavior or ownership changes. Close only verified scope; do not claim hosted CI, publication, real OBS/payment acceptance or deployment from local checks.

If interrupted, record branch/base/HEAD, required commits/dirty files, source/contract/environment/build freshness, passed/failed/pending checks, safe log paths, owned processes/cleanup and the next concrete action. Never record secrets, grant/receipt/consent URLs or raw private data. Follow Git/CI cleanup only after verified authorized integration, preserving unfinished dependencies.

Local-first work and Resend selection remain confirmed. Deployment prerequisites stay in docs/DEPLOYMENT_PREPARATION_CHECKLIST.md; they are deferred, not waived. Do not automatically deploy, migrate persistent storage, activate live payments or start other planned batches.

Finish with changes, verification, meaningful remaining limits and the next task.
```

## Discussion or review only

```text
Review Darve frontend [AUTHORIZED_SCOPE] without changing files or starting implementation.
Read the current-state/tracker/architecture and relevant owning sections. Inspect actual source and report concrete findings, options, dependencies and acceptance requirements. Distinguish missing implementation from missing proof. Preserve confirmed local-first, design and Resend decisions.
```

## Interrupted work

```text
Resume Darve frontend [AUTHORIZED_SCOPE] from its owning implementation record.
First verify the recorded branch/source/contract/build and actual dirty files/processes. Preserve prior work and completed checks, then continue the recorded next action within the existing authorization. Rebuild/retest only when changed inputs or unresolved failures require it. Update the restart note and tracker at the next checkpoint.
```
