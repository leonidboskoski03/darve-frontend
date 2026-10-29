# Frontend documentation

Start with [CURRENT_STATE](CURRENT_STATE.md), the relevant [task tracker](FRONTEND_TASK_TRACKER.md) row and [ARCHITECTURE](ARCHITECTURE.md). Follow [WORKFLOW](WORKFLOW.md). Use the table below to read only the owning documents for the authorized work. Historical test counts and reference folders do not establish current functionality.

## Task routing

| Work                                           | Owning records                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current capabilities and next action           | [CURRENT_STATE](CURRENT_STATE.md)                                                                                                                                                                                                              |
| Task IDs, status and remaining work            | [FRONTEND_TASK_TRACKER](FRONTEND_TASK_TRACKER.md)                                                                                                                                                                                              |
| Batch scope, dependencies and acceptance       | [PLAN](PLAN.md)                                                                                                                                                                                                                                |
| Batch/task/PR planning                         | [BATCH_DELIVERY](BATCH_DELIVERY.md)                                                                                                                                                                                                            |
| Development and verification                   | [WORKFLOW](WORKFLOW.md), [ENGINEERING](ENGINEERING.md)                                                                                                                                                                                         |
| New or interrupted chat                        | [NEW_CHAT_TASK_TEMPLATE](NEW_CHAT_TASK_TEMPLATE.md), [usage guide](NEW_CHAT_TEMPLATE_USAGE_GUIDE.md)                                                                                                                                           |
| FW-02 Git/CI setup evidence                    | [FW02_GIT_CI_IMPLEMENTATION](FW02_GIT_CI_IMPLEMENTATION.md)                                                                                                                                                                                    |
| Git, hooks, CI, release and cleanup            | [GIT_AND_CI_SETUP](GIT_AND_CI_SETUP.md)                                                                                                                                                                                                        |
| Module responsibilities and import enforcement | [ARCHITECTURE](ARCHITECTURE.md), [ESLint rules](../tools/eslint-architecture.mjs)                                                                                                                                                              |
| F00 structure, dependencies and dated proof    | [FRONTEND_SKELETON](FRONTEND_SKELETON.md), [package manifest](../package.json)                                                                                                                                                                 |
| F01 source selection and screen inventory      | [SOURCE_PROJECTS_AND_DESIGN_BASELINES](SOURCE_PROJECTS_AND_DESIGN_BASELINES.md), [F01-01 audit](F01_REFERENCE_AND_COMPONENT_AUDIT.md), [F01-02 implementation](F01_DESIGN_SYSTEM_IMPLEMENTATION.md), [DESIGN_AND_MOTION](DESIGN_AND_MOTION.md) |
| F02 authority, contracts, state and realtime   | [INTEGRATION](INTEGRATION.md), [FRONTEND_API_CONTRACT_MATRIX](FRONTEND_API_CONTRACT_MATRIX.md), [F02 implementation](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md)                                                                                 |
| F03 landing and creator onboarding             | [F03 implementation and acceptance](F03_CREATOR_CONNECTION_IMPLEMENTATION.md)                                                                                                                                                                  |
| Environment, flags, security and observability | [OPERATIONS](OPERATIONS.md)                                                                                                                                                                                                                    |
| Disposable local API/session acceptance        | [LOCAL_API_COMPOSITION](LOCAL_API_COMPOSITION.md)                                                                                                                                                                                              |
| Deferred hosting and activation gates          | [DEPLOYMENT_PREPARATION_CHECKLIST](DEPLOYMENT_PREPARATION_CHECKLIST.md)                                                                                                                                                                        |

## Documentation ownership

The tracker is the single status ledger. PLAN owns batch requirements. CURRENT_STATE summarizes capabilities and priorities, not a chronological progress log. Implementation records own detailed evidence/restart notes. Architecture, design, integration and operations own their respective rules. Root [AGENTS](../AGENTS.md) directs contributors to those records.

Create a feature implementation record when its batch begins, using stable IDs such as `F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md`. Keep its checklist, decisions, verification and unfinished restart note together. Link it from the tracker/index. Do not pre-create empty implementation reports for every feature or duplicate a contract into several records. Preserve dated evidence when moving a section; leave a clear pointer from the former location.

Links inside this repository remain independently checkable without sibling projects. References to external workspace sources use explicit code paths with their owner/revision context. The current `docs:check` validates repository-local file existence; it does not verify heading anchors, web URLs, source facts or Markdown inside every code fence.

## Adapted from backend documentation

| Backend pattern                                            | Frontend treatment                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Index, current state and tracker                           | Corresponding records above, with F-series IDs and frontend evidence only                                          |
| Workflow, Git/CI and restart templates                     | Adapted to actual Vite/TypeScript/Vitest/Playwright commands and installed hooks                                   |
| Backend batches and skeleton                               | Existing PLAN retained for scope; F00 evidence moved intact to FRONTEND_SKELETON                                   |
| Frontend baseline comparison                               | Frontend source catalogue preserves selected F/M/R/A references and incomplete audit status                        |
| API/DTO catalogue and consumer handoff                     | Frontend contract matrix names owning backend records; exact mappings remain F02 work                              |
| Deployment preparation                                     | Existing deferred list moved intact from OPERATIONS to its own checklist                                           |
| Database/provider/business/security implementation records | Remain backend-owned; no copied database schema, credentials, obsolete rules or fabricated frontend implementation |

The local backend root is `../darve-backend`. Begin there with its `AGENTS.md`, `docs/CURRENT_STATE.md`, `docs/BACKEND_TASK_TRACKER.md` and `docs/README.md` when a frontend task needs current contract evidence. Older backend inventories may be superseded; the founder's latest Resend/local-first decisions and current owning contracts take precedence.
