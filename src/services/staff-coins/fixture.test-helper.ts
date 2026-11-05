export const ids = {
  owner: '12345678-1234-4234-8234-123456789012',
  creator: '22345678-1234-4234-8234-123456789012',
  program: '32345678-1234-4234-8234-123456789012',
  ticket: '42345678-1234-4234-8234-123456789012',
};
export const rewards = {
  'collection.first_success': '20',
  'funding.first_goal': '40',
  'completion.first_declaration': '40',
  'suggestions.10': '10',
  'suggestions.100': '100',
  'suggestions.1000': '1000',
};
export const session = (owner = true) => ({
  state: 'authenticated',
  staff: { id: ids.owner, role: owner ? 'OWNER_ADMIN' : 'SUPPORT', revision: 1 },
  permissions: owner
    ? ['coins.read', 'coins.configure', 'coins.adjust', 'coins.price']
    : ['coins.assigned.read', 'tickets.assigned.read'],
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  authenticatedAt: new Date().toISOString(),
  csrfToken: 's'.repeat(43),
});
export const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  data,
});
export const problem = (code = 'STALE_VERSION') => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  error: {
    code,
    message: 'private reason must not render',
    requestId: 'synthetic-coins',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
export const configuration = () => ({
  schemaVersion: 1,
  programId: ids.program,
  revision: 1,
  hasMore: false,
  configurations: [{ revision: 1, active: true, rewards, createdAt: '2026-11-05T00:00:00.000Z' }],
});
export const account = () => ({
  schemaVersion: 1,
  ownerId: ids.creator,
  balance: '9007199254740993',
  revision: 1,
  progress: 10,
  progressCap: 1000,
  state: 'synchronized',
  ledgerHasMore: false,
  claims: [],
  ledger: [],
});
export const item = () => ({
  id: 'synthetic_template',
  displayName: '<script>Literal template</script>',
  assetVersion: 1,
  priceRevision: 1,
  amount: '10',
  available: true,
  owned: false,
  ownershipState: 'not_owned',
});
export const configurationInput = () => ({
  expectedRevision: 1,
  active: false,
  rewards: { ...rewards },
  reason: 'Reviewed synthetic change',
  confirmation: { programId: ids.program },
});
