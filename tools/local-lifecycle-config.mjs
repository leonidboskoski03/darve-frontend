/** Exact controlled lifecycle compositions. Validate before reading source, secrets or Docker. */
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
  const staff = task === 'f10-04';
  const funded = task === 'f10-03' || staff;
  if (
    (!funded && task !== 'f10-02') ||
    port !== 3310 ||
    !Array.isArray(origins) ||
    origins.length !== 1 ||
    origins[0] !== 'http://127.0.0.1:4175' ||
    [collection, review, terms].some((value) => value !== true) ||
    reporting !== !funded ||
    overlay !== funded ||
    checkout !== funded ||
    contributionReads !== false ||
    support !== staff ||
    coins !== staff ||
    sandboxPayment !== undefined ||
    operatorOAuth !== undefined ||
    qrPublicOrigin !== undefined
  )
    throw new Error(
      'Creator lifecycle requires its exact controlled F10-02, F10-03 or F10-04 composition.',
    );
}
