/** Only the F10-02 local creator journey. Validate before reading source, secrets or Docker. */
export function assertLifecycleComposition({
  task,
  port,
  origins,
  collection,
  review,
  reporting,
  terms,
  overlay = false,
  contributionReads = false,
  checkout = false,
  sandboxPayment,
  operatorOAuth,
  qrPublicOrigin,
  support = false,
  coins = false,
}) {
  if (
    task !== 'f10-02' ||
    port !== 3310 ||
    !Array.isArray(origins) ||
    origins.length !== 1 ||
    origins[0] !== 'http://127.0.0.1:4175' ||
    [collection, review, reporting, terms].some((value) => value !== true) ||
    [overlay, contributionReads, checkout, support, coins].some((value) => value !== false) ||
    sandboxPayment !== undefined ||
    operatorOAuth !== undefined ||
    qrPublicOrigin !== undefined
  )
    throw new Error('Creator lifecycle requires its exact provider-free F10-02 composition.');
}
