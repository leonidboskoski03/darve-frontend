import type {
  SupportMessagePageResponseSchema,
  StaffSupportTicketResponseSchema,
} from '../contracts/index';
export const ids = {
  ticket: '12345678-1234-4234-8234-123456789012',
  agent: '22345678-1234-4234-8234-123456789012',
  other: '32345678-1234-4234-8234-123456789012',
  owner: '42345678-1234-4234-8234-123456789012',
};
export const permissions = [
  'tickets.queue.read',
  'tickets.assigned.read',
  'tickets.reply',
  'tickets.note',
  'tickets.availability.write',
  'tickets.status.write',
];
export const staffSession = (owner = false) => ({
  state: 'authenticated',
  staff: {
    id: owner ? ids.owner : ids.agent,
    role: owner ? 'OWNER_ADMIN' : 'SUPPORT',
    revision: 1,
  },
  permissions: [...permissions, ...(owner ? ['tickets.reassign', 'tickets.context.write'] : [])],
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  authenticatedAt: new Date().toISOString(),
  csrfToken: 's'.repeat(43),
});
export const ticket = (): ReturnType<typeof StaffSupportTicketResponseSchema.parse>['data'] => ({
  id: ids.ticket,
  category: 'account',
  status: 'open',
  revision: 2,
  contextRevision: 0,
  createdAt: '2026-11-03T12:00:00.000Z',
  updatedAt: '2026-11-03T12:00:00.000Z',
  contexts: [],
  unread: 1,
  readSequence: 0,
  ownerId: ids.owner,
  assigneeId: ids.agent,
  authorityRevision: 5,
  staffRevision: 9,
  noteUnread: 1,
  noteReadSequence: 0,
});
export const queue = () => ({
  id: ids.ticket,
  category: 'account' as const,
  status: 'open' as const,
  createdAt: '2026-11-03T12:00:00.000Z',
  authorityRevision: 5,
});
export const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  data,
});
export const errorBody = (code = 'UNAUTHENTICATED') => ({
  schemaVersion: 1,
  serverTime: new Date().toISOString(),
  error: {
    code,
    message: 'private-fixture-detail',
    requestId: 'synthetic-staff-work',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
export const message = (
  sequence = 1,
): ReturnType<typeof SupportMessagePageResponseSchema.parse>['data']['items'][number] => ({
  id: `${String(sequence).padStart(8, '0')}-1234-4234-8234-123456789012`,
  sequence,
  author: 'staff' as const,
  body: 'Synthetic staff body ' + sequence,
  createdAt: '2026-11-03T12:00:00.000Z',
  redacted: false,
});
