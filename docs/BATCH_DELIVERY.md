# Batches, tasks and planning

This follows the backend's bounded batches and reviewed task integration. [PLAN](PLAN.md) owns scope/dependencies/acceptance; [FRONTEND_TASK_TRACKER](FRONTEND_TASK_TRACKER.md) owns statuses; [WORKFLOW](WORKFLOW.md) owns execution; [GIT_AND_CI_SETUP](GIT_AND_CI_SETUP.md) owns branch/release policy.

## Units of work

| Unit    | Meaning                                                    | Example                                                  |
| ------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Batch   | A coherent capability with a clear acceptance boundary     | F06: usable guest contribution and private receipts      |
| Task    | A reviewable result inside a batch; usually one focused PR | F06-01: public challenge/terms and guest authority       |
| Commit  | A meaningful implementation/evidence checkpoint            | Validated amount handling and its relevant cases         |
| Release | Compatible capabilities proven together                    | Approved creator/guest/OBS candidate promoted dev → main |

A batch need not be one huge PR, and a task is not one PR per file/component. Split when a result has independent acceptance, changes a different authority/contract, needs a distinct decision or becomes hard to review. Keep coupled implementation/tests together. Do not make separate batches for every technology or build all screens on fake data before connecting a real journey.

## Before a batch

Write its problem/outcome, source/design/contract evidence, in/out scope, dependencies, proposed tasks and done criteria. Name missing inputs and independent work. Existing confirmed decisions are not reopened by default. Deployment stays deferred as agreed.

Plan the next batch concretely; keep later batches at scope/dependency level. Do not invent endpoint tasks before F02 maps the API or pretend missing designs/provider permissions are settled. One-task authorization covers that task; explicit whole-batch authorization allows its dependent tasks without permission for every file/commit. Product decisions and external actions retain their actual scope.

## Task cycle

1. Select a stable ID/deliverable and inspect actual source, design and Git state.
2. Put behavior, state/error/security coverage, contract work, tests and acceptance in a short owning-record checklist.
3. Branch from current dev with required history; implement/test the smallest complete result. Include accessibility, errors, expiry and architecture now rather than leaving all quality work until the end.
4. Run focused checks during iteration and required settled local checks once. Demonstrate visible results; distinguish component, local API and real provider/OBS proof.
5. Open a PR into dev, settle its description/candidate, wait for current light CI, review and integrate within authorization. Repeat checks for changes/failures, not unchanged green state.
6. Update owner/tracker once, verify ancestry and clean integrated temporary branches safely. Continue the next authorized dependent task.

Keep local verification, PR integration, hosted checks and actual release/deployment as distinct evidence fields/notes. A locally qualified feature is not necessarily integrated or shipped. Light CI cannot close real payment/OBS acceptance.

## Batch review and release

At the batch boundary, demonstrate complete behavior and negative/recovery cases, consolidate genuine gaps and check affected neighbors. F10 supplies broader joint acceptance; it does not justify leaving earlier tasks untested. Several batches can accumulate on dev before a release is ready. Do not promote main after every task just because CI is green.

Backend defects keep their backend owner and compatible source/contract revision. Coordinate dependencies instead of hiding them behind weakened frontend rules. Keep one implementation record per actual owner; no parallel trackers or repeated giant plans.

## Proposed first slices

F01-01 through F01-03 are registered in the tracker with bounded foundation evidence. Refine remaining slices before implementation; this list does not authorize additional product work:

- F01-01: [selected screen/component/asset inventory and missing design decisions](F01_REFERENCE_AND_COMPONENT_AUDIT.md); no API or redesign implementation.
- F01-02: [shared tokens and primitives](F01_DESIGN_SYSTEM_IMPLEMENTATION.md) needed by the next screens, including responsive/focus/loading/error states.
- F01-03: [required motion patterns plus keyboard, reduced-motion and fixture visual verification](F01_DESIGN_SYSTEM_IMPLEMENTATION.md#f01-03-motion-patterns); feature-screen/OBS reference acceptance stays with the actual feature callers.
- F02-01: [current API/authority mapping and reproducible exact public contracts](F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md).
- F02-02: validated transport, real session/CSRF/cache isolation, errors and local backend configuration.
- F02-03: reviewed overlay v1/v2 resource/version/freshness-aware realtime with actual stream/revocation proof. Support wire schemas remain F08-owned; no dashboard SSE endpoint is invented.

F03-01/02/03 now cover the coupled [standalone landing, creator/terms/connection vertical journey and isolated qualification](F03_CREATOR_CONNECTION_IMPLEMENTATION.md). They share one focused integration PR because route/session/terms behavior and acceptance are coupled. F03-AC-01 now records actual founder-assisted registered-app consent and purpose-grant proof; local synthetic navigation remains separately labelled. F04-01 maps the selected collection journey and explicit contract/readiness findings before F04-02 controls and F04-03 review/acceptance implementation.

Create tracker rows/implementation records when the scopes are settled. Then build visible vertical journeys such as real creator connection/collection. Guest, OBS, staff and coins follow their dependencies. Avoid generic infrastructure before a concrete caller needs it.
