# Services

External infrastructure only: public configuration and QueryClient composition are implemented. Planned named modules are `api/`, `contracts/`, `realtime/`, `telemetry/` and `feature-flags/`. Network calls and browser storage must enter here, never directly from components. Business endpoint/query policies remain in their owning feature; services must not turn into a business workflow layer.

No API transport, provider SDK, session, feature activation or error reporting endpoint is implemented in F00. F02 must first map the real backend contracts, CSRF and distinct creator/staff/guest/overlay authority. Do not invent endpoints to make a skeleton look connected.
