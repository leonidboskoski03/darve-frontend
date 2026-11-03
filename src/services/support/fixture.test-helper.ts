import type {
  SupportTicketResponseSchema,
  SupportMessagePageResponseSchema,
} from '../contracts/index';
type SupportTicket = ReturnType<typeof SupportTicketResponseSchema.parse>['data'];
type SupportMessage = ReturnType<
  typeof SupportMessagePageResponseSchema.parse
>['data']['items'][number];
export const ids = {
  ticket: '12345678-1234-4234-8234-123456789012',
  other: '22345678-1234-4234-8234-123456789012',
  context: '32345678-1234-4234-8234-123456789012',
};
export const stamp = '2026-11-03T12:00:00.000Z';
export const syntheticSupportSession = {
  authenticated: true,
  user: {
    id: ids.other,
    displayName: 'Synthetic support creator',
    termsStatus: {
      status: 'unconfigured',
      requiredVersion: null,
      acceptedVersion: null,
      acceptedAt: null,
    },
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
  csrfToken: 'a'.repeat(43),
};
export const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: stamp, data });
export const ticket = (): SupportTicket => ({
  id: ids.ticket,
  category: 'account',
  status: 'open',
  revision: 1,
  contextRevision: 0,
  createdAt: stamp,
  updatedAt: stamp,
  contexts: [],
  unread: 1,
  readSequence: 0,
});
export const message = (sequence = 1): SupportMessage => ({
  id: `${String(sequence).padStart(8, '0')}-1234-4234-8234-123456789012`,
  sequence,
  author: sequence === 1 ? 'streamer' : 'staff',
  body:
    sequence === 1
      ? 'Synthetic creator question <b>plain text</b>'
      : `Synthetic support reply ${sequence}`,
  createdAt: stamp,
  redacted: false,
});
export const errorBody = (code = 'CONFLICT', retryAfterSeconds: number | null = null) => ({
  schemaVersion: 1,
  serverTime: stamp,
  error: {
    code,
    message: 'private-backend-detail',
    requestId: 'synthetic-support',
    retryable: retryAfterSeconds !== null,
    retryAfterSeconds,
    issues: [],
    refetch: null,
  },
});
