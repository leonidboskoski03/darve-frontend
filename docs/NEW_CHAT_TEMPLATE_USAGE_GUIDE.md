# Using the new-chat template

## Choose scope

Use the [tracker](FRONTEND_TASK_TRACKER.md) to select the work and [PLAN](PLAN.md) for its acceptance. One subtask authorizes less than an entire batch; avoid saying “finish the frontend” when you want a bounded design audit. Use the review-only template when deciding before implementation.

For example, the next F01 work can begin with:

```text
Use docs/NEW_CHAT_TASK_TEMPLATE.md for F01 reference/component inventory only.
Inspect the selected F dashboard, M/R OBS and A contribution sources and map screens, components, states and missing assets/designs. Preserve the selected visuals. Record the inventory and proposed next implementation slice. Do not implement API/authentication, payments or a new design direction in this slice.
```

This is an example scope, not evidence that F01 is already authorized or complete. If you want all of F01 implemented, state that explicitly and include design-system/motion acceptance. F02 is a separate contract/authority integration batch.

## Start the chat

1. Use the frontend project/directory; the backend folder is a separate repository/reference.
2. Paste the implementation, discussion or resume template and replace the scope marker.
3. Name relevant constraints/design decisions not already in current records. Avoid pasting secrets or temporary authorization URLs.
4. Have the task reconstruct Git/source/runtime state and read only owning sections. The actual checkout may contain unpublished work beyond a remembered commit.

## Resume safely

Point to the owning record's restart note. Preserve local changes and required dependency commits before changing branch. A stopped server, old consent session or past passing test is not automatically reusable. Recheck build freshness and environment identity; rerun only necessary checks. If another chat is actively editing the same checkout, coordinate file ownership rather than working concurrently by assumption.

## Assess the handoff

A useful result states what changed, the exact scope verified, failures/remaining evidence and the next action. Look for an updated owner record/tracker and source identity. UI screenshots do not prove payments; sandbox tests do not prove live exposure; docs/CI configuration do not prove hosted checks or deployment. Confirmed decisions should be written to their owner so the next chat does not ask again.
