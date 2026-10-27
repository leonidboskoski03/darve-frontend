# Services

External infrastructure only: public configuration and QueryClient composition are implemented. The pinned browser contract facade is implemented in `contracts/`. Planned infrastructure modules are `api/`, `realtime/`, `telemetry/` and `feature-flags/`. Network calls and browser storage must enter here, never directly from components. Business endpoint/query policies remain in their owning feature; services must not turn into a business workflow layer.

No API transport, provider SDK, session, feature activation or error reporting endpoint is implemented in F00. F02-01 records the exact contracts and distinct creator/staff/guest/overlay authority in the frontend contract matrix; real transport/session/realtime remain later F02 tasks. Do not invent endpoints to make a skeleton look connected.
