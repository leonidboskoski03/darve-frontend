# Pinned browser contracts

This committed artifact is built from the exact backend revision in [provenance](provenance.json). It contains public compiled modules/declarations and reviewed package metadata only. The dependency and lockfile point to this tarball, never a changing sibling checkout.

After `npm ci`, `npm run contracts:check` verifies the artifact and installed package without the backend folder. Refresh only through the reviewed packaging procedure in the [F02 implementation record](../../docs/F02_CONTRACTS_AND_AUTH_IMPLEMENTATION.md). Update artifact, provenance, route mapping, facade and lockfile together. Do not edit compiled schemas by hand.
