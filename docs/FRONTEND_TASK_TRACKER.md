# Frontend task tracker

This is the single frontend task-status ledger. [PLAN](PLAN.md) owns deliverables/dependencies; owning implementation records contain detailed proof and restart notes. Backend B-series statuses remain in the backend tracker and are not changed by an F-series closure.

Statuses: **OPEN** (not started), **IN_PROGRESS** (started, acceptance incomplete), **BLOCKED** (specific required input prevents the recorded next action), **CLOSED** (done within the stated verified scope), **DEFERRED** (explicitly postponed). Planned external work is not automatically blocked, authorized or complete. Local closure does not imply hosted, provider or release acceptance.

## Delivery batches

| ID  | Work                                             | Status      | Evidence or next action                                                                                                                    |
| --- | ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| F00 | Architecture and engineering foundation          | CLOSED      | Local foundation `ffc472d`; [skeleton evidence](FRONTEND_SKELETON.md). Hosted CI/remote configuration are separate.                        |
| F01 | Reference audit, design and motion systems       | IN_PROGRESS | [F01-01 inventory](F01_REFERENCE_AND_COMPONENT_AUDIT.md) is locally qualified; tokens/primitives and motion acceptance remain.             |
| F02 | Contracts, transport, authority and environments | OPEN        | Populate the [contract matrix](FRONTEND_API_CONTRACT_MATRIX.md), package exact backend contracts and establish isolated local composition. |
| F03 | Landing, creator connection and onboarding       | OPEN        | Depends on F01/F02. Actual provider/terms state; no fake login.                                                                            |
| F04 | Collection, shortlist and acceptance             | OPEN        | Depends on connection/contract foundations; durable snapshots and backend-owned countdown/acceptance.                                      |
| F05 | Dashboard, history and declaration               | OPEN        | Real reporting and original-stream declaration; preserve currencies, timezones and availability.                                           |
| F06 | Guest contribution and private receipts          | OPEN        | Separate guest authority, real receiving readiness, exact money and canonical payment state.                                               |
| F07 | OBS presentation                                 | OPEN        | Selected M/R design, read-only grant bootstrap, versions/freshness and actual QR/OBS proof.                                                |
| F08 | Staff portal and support                         | OPEN        | Independent staff authority, real role-limited tickets/recovery; Resend configuration/delivery remains external acceptance.                |
| F09 | Coins and templates                              | OPEN        | Actual ledger, current-price-confirmed redemption, permanent entitlement and server availability gates.                                    |
| F10 | Joint browser/API/OBS acceptance                 | OPEN        | Requires real feature wiring, including F08/F09, and evidence at browser/provider/OBS layers.                                              |
| F11 | Hosted staging and release preparation           | OPEN        | [Deferred deployment checklist](DEPLOYMENT_PREPARATION_CHECKLIST.md); a separate authorized activation checkpoint.                         |

See PLAN for exact backend mappings and acceptance; this table intentionally does not duplicate them.

## Registered product tasks

| ID     | Work                                  | Status | Owning evidence and next action                                                                                                                                                                                               |
| ------ | ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01-01 | Selected screen/component/asset audit | CLOSED | [Audit](F01_REFERENCE_AND_COMPONENT_AUDIT.md): 12 primary reference surfaces, shared families, migration gaps and synthetic reference captures. Local inspection scope only; implementation and batch acceptance remain open. |

## Engineering workflow

| ID    | Work                                                      | Status | Owning record                                                                                                             |
| ----- | --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| FW-01 | Adapt backend documentation/workflow patterns to frontend | CLOSED | [WORKFLOW](WORKFLOW.md): ownership split, restart templates, Git/CI, source/contract catalogues and docs-only validation. |

| FW-02 | Align backend-style dev/main PR/CI and bootstrap the supplied frontend remote | CLOSED | [Git/CI implementation](FW02_GIT_CI_IMPLEMENTATION.md): local policy cases, dev bootstrap/protection/PR evidence and first stable main boundary. |

## Maintaining the tracker

Add stable subtasks/defects when useful, for example `F02-01` or `F06-DEF-01`, with an owner, concrete next action and acceptance link. Do not renumber closed work, create parallel hidden status lists or mark a whole batch closed from one passing fixture. Reopen a regression with evidence; preserve earlier scope/history. Missing external evidence stays visible under its owner. Update CURRENT_STATE only when capabilities, priorities or blockers change.
