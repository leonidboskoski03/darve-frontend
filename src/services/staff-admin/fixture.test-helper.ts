import type {
  StaffChallengeResponseSchema,
  StaffStreamerResponseSchema,
  ReviewResponseSchema,
  RestrictionResponseSchema,
  StaffMemberResponseSchema,
} from '../contracts/index';
export const ids = {
  creator: '12345678-1234-4234-8234-123456789012',
  challenge: '22345678-1234-4234-8234-123456789012',
  support: '32345678-1234-4234-8234-123456789012',
  owner: '42345678-1234-4234-8234-123456789012',
  invitation: '52345678-1234-4234-8234-123456789012',
  review: '62345678-1234-4234-8234-123456789012',
  other: '72345678-1234-4234-8234-123456789012',
};
export const session = (owner = true) => ({
  state: 'authenticated',
  staff: {
    id: owner ? ids.owner : ids.support,
    role: owner ? 'OWNER_ADMIN' : 'SUPPORT',
    revision: 1,
  },
  permissions: [
    'review.read',
    'review.flag',
    ...(owner ? ['staff.manage', 'staff.audit.read', 'review.resolve', 'moderation.write'] : []),
  ],
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  authenticatedAt: new Date().toISOString(),
  csrfToken: 's'.repeat(43),
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
    message: 'private detail must not render',
    requestId: 'synthetic-staff-admin',
    retryable: false,
    retryAfterSeconds: null,
    issues: [],
    refetch: null,
  },
});
export const member = (
  owner = false,
): ReturnType<typeof StaffMemberResponseSchema.parse>['data'] => ({
  id: owner ? ids.owner : ids.support,
  role: owner ? 'OWNER_ADMIN' : 'SUPPORT',
  active: true,
  revision: 1,
});
export const streamer = (): ReturnType<typeof StaffStreamerResponseSchema.parse>['data'] => ({
  id: ids.creator,
  displayName: 'Synthetic creator',
  createdAt: '2026-11-03T12:00:00.000Z',
});
export const challenge = (): ReturnType<
  typeof StaffChallengeResponseSchema.parse
>['data']['challenge'] => ({
  id: ids.challenge,
  publicId: ids.other,
  ownerId: ids.creator,
  creatorDisplayName: 'Synthetic creator',
  provider: 'TWITCH',
  broadcastId: 'synthetic-original-broadcast',
  acceptedAt: '2026-11-03T12:00:00.000Z',
  termsId: ids.invitation,
  text: '<script>literal synthetic challenge</script>',
  contentAvailable: true,
  goal: { amountMinor: '9007199254740993', currency: 'EUR' },
  fundingDeadlineAt: '2026-11-03T13:00:00.000Z',
  declaredAt: null,
  funding: null,
});
export const review = (): ReturnType<typeof ReviewResponseSchema.parse>['data'] => ({
  id: ids.review,
  userId: ids.creator,
  challengeId: ids.challenge,
  state: 'open',
  revision: 1,
  reason: 'Synthetic original flag',
  flagReason: 'Synthetic original flag',
  createdAt: '2026-11-03T12:00:00.000Z',
  updatedAt: '2026-11-03T12:00:00.000Z',
});
export const restriction = (): ReturnType<typeof RestrictionResponseSchema.parse>['data'] => ({
  userId: ids.creator,
  banned: false,
  revision: 0,
  updatedAt: null,
  externalCheckoutRecall: 'not_guaranteed',
});
