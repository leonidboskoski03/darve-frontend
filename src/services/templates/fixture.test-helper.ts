// Explicit synthetic identity used only by template unit/browser acceptance.
export const syntheticTemplateSession = {
  authenticated: true,
  user: {
    id: '11223344-1234-4234-8234-112233445566',
    displayName: 'Synthetic template creator',
    termsStatus: {
      status: 'accepted',
      documentId: 'synthetic',
      requiredVersion: 'v1',
      classification: 'development',
      contentHash: 'a'.repeat(64),
      acceptedVersion: 'v1',
      acceptedAt: '2026-11-04T12:00:00.000Z',
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
