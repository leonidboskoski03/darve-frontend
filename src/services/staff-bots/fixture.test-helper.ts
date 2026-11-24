// Synthetic staff data for bot-account unit tests only. No product import.
export const ids = {
  owner: '12345678-1234-4234-8234-123456789012',
  creator: '22345678-1234-4234-8234-123456789012',
};
export const session = (owner = true) => ({
  state: 'authenticated',
  staff: { id: ids.owner, role: owner ? 'OWNER_ADMIN' : 'SUPPORT', revision: 1 },
  permissions: owner ? ['bots.read', 'bots.write'] : ['tickets.assigned.read'],
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
    requestId: 'synthetic-bots',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
