# Entities

Domain vocabulary and pure view-model transformations live in named slices such as `challenge/`, `money/` and `session/` as their integration batches begin. Do not create duplicate DTOs or fake domain models now. Backend business invariants remain authoritative. Each implemented slice exposes an explicit `index.ts`. Entities cannot import features, React UI, routes or app composition.
