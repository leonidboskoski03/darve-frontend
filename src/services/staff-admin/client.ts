import {
  StaffPageQuerySchema,
  StaffInspectionQuerySchema,
  ReviewPageQuerySchema,
  StaffInviteInputSchema,
  StaffMemberChangeInputSchema,
  StaffReasonInputSchema,
  StaffInvitationResponseSchema,
  StaffInvitationRevokedResponseSchema,
  StaffMemberResponseSchema,
  StaffDirectoryResponseSchema,
  StaffAuditResponseSchema,
  StaffChallengePageResponseSchema,
  StaffChallengeResponseSchema,
  StaffStreamerResponseSchema,
  RestrictionResponseSchema,
  ReviewResponseSchema,
  ReviewPageResponseSchema,
  RestrictionCommandSchema,
  ReviewFlagSchema,
  ReviewTransitionSchema,
  SupportContextSchema,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { StaffAccess } from '@/services/staff-access/index';
export type StaffChallenge = ReturnType<
  typeof StaffChallengeResponseSchema.parse
>['data']['challenge'];
export type StaffStreamer = ReturnType<typeof StaffStreamerResponseSchema.parse>['data'];
export type StaffReview = ReturnType<typeof ReviewResponseSchema.parse>['data'];
export type StaffRestriction = ReturnType<typeof RestrictionResponseSchema.parse>['data'];
export type StaffMember = ReturnType<typeof StaffMemberResponseSchema.parse>['data'];
export type StaffInvitation = ReturnType<typeof StaffInvitationResponseSchema.parse>['data'];
export type AdminView = 'challenges' | 'challenge' | 'streamer' | 'reviews' | 'staff' | 'audit';
export type AdminSelection = Readonly<{
  view: AdminView;
  id: string;
  owner: string;
  state: string;
}>;
export type AdminAttempt = Readonly<{
  kind: 'flag' | 'transition' | 'restriction' | 'invite' | 'revoke-invitation' | 'member';
  id: string | null;
  key: string;
  body: Readonly<Record<string, unknown>>;
}>;
export class StaffAdminError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Staff administration request could not be confirmed.');
  }
}
export const adminUncertain = (error: unknown) =>
  error instanceof StaffAdminError &&
  (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
    (error.problem.status ?? 0) >= 500);
const invalid = (): never => {
  throw new StaffAdminError(failure('configuration', 'INVALID_STAFF_ADMIN_INPUT'));
};
const mismatch = (): never => {
  throw new StaffAdminError(failure('protocol', 'STAFF_ADMIN_RESOURCE_MISMATCH'));
};
const uuid = (id: string) => {
  if (!SupportContextSchema.safeParse({ kind: 'challenge', id }).success) invalid();
  return id;
};
export function createStaffAdminClient(access: StaffAccess, frontendOrigin: string) {
  const scope = access.getSnapshot().scope;
  const attempts = new WeakSet<AdminAttempt>();
  let busy = false,
    retryAt = 0;
  const active = () => {
    const current = access.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new StaffAdminError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const permit = (permission: string) => {
    active();
    if (!access.getSnapshot().permissions.includes(permission))
      throw new StaffAdminError(failure('authority', 'STAFF_PERMISSION_REQUIRED', 403));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    if (Date.now() < retryAt)
      throw new StaffAdminError({
        ...failure('http', 'RATE_LIMITED', 429),
        retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000),
      });
    const result = await access.request(input);
    active();
    if (result.kind === 'data') return result.data;
    const error =
      result.kind === 'error' ? result : failure('protocol', 'INVALID_STAFF_ADMIN_RESPONSE');
    if ([429, 503].includes(error.status ?? 0) && error.retryAfterSeconds !== null)
      retryAt = Date.now() + Math.max(1, error.retryAfterSeconds) * 1000;
    throw new StaffAdminError(error);
  };
  const query = (raw: Record<string, unknown>, kind: 'staff' | 'challenges' | 'reviews') => {
    const schema =
      kind === 'challenges'
        ? StaffInspectionQuerySchema
        : kind === 'reviews'
          ? ReviewPageQuerySchema
          : StaffPageQuerySchema;
    const parsed = schema.safeParse({ limit: 20, ...raw });
    if (!parsed.success) return invalid();
    return new URLSearchParams(
      Object.entries(parsed.data).map(([k, v]) => [k, String(v)]),
    ).toString();
  };
  const page = <T extends { id: string }>(
    data: { items: T[]; nextCursor: string | null },
    cursor: string | null,
  ) => {
    if (
      new Set(data.items.map((row) => row.id)).size !== data.items.length ||
      (cursor !== null && data.nextCursor === cursor)
    )
      mismatch();
    return data;
  };
  const prepare = (
    kind: AdminAttempt['kind'],
    id: string | null,
    body: Record<string, unknown>,
  ) => {
    active();
    if (id !== null) uuid(id);
    const copy = structuredClone(body);
    if ('confirmation' in copy && typeof copy.confirmation === 'object' && copy.confirmation)
      Object.freeze(copy.confirmation);
    const attempt = Object.freeze({
      kind,
      id,
      key: crypto.randomUUID(),
      body: Object.freeze(copy),
    });
    attempts.add(attempt);
    return attempt;
  };
  const permissions = {
    flag: 'review.flag',
    transition: 'review.resolve',
    restriction: 'moderation.write',
    invite: 'staff.manage',
    'revoke-invitation': 'staff.manage',
    member: 'staff.manage',
  } as const;
  return {
    access,
    scope,
    retryDelay: () => Math.max(0, retryAt - Date.now()),
    async challenges(owner: string, cursor: string | null, signal: AbortSignal) {
      permit('review.read');
      const q = query(
        { ...(owner ? { ownerId: uuid(owner) } : {}), ...(cursor !== null ? { cursor } : {}) },
        'challenges',
      );
      const value = page(
        (
          await request({
            path: '/admin/v1/challenges?' + q,
            schema: StaffChallengePageResponseSchema,
            success: [200],
            signal,
          })
        ).data,
        cursor,
      );
      if (owner && value.items.some((row) => row.ownerId !== owner)) mismatch();
      return value;
    },
    async challenge(id: string, signal: AbortSignal) {
      permit('review.read');
      const value = (
        await request({
          path: '/admin/v1/challenges/' + uuid(id),
          schema: StaffChallengeResponseSchema,
          success: [200],
          signal,
        })
      ).data.challenge;
      if (value.id !== id) mismatch();
      return value;
    },
    async streamer(id: string, signal: AbortSignal) {
      permit('review.read');
      const value = (
        await request({
          path: '/admin/v1/streamers/' + uuid(id),
          schema: StaffStreamerResponseSchema,
          success: [200],
          signal,
        })
      ).data;
      if (value.id !== id) mismatch();
      return value;
    },
    async restriction(id: string, signal: AbortSignal) {
      permit('moderation.write');
      const value = (
        await request({
          path: '/admin/v1/streamers/' + uuid(id) + '/restrictions',
          schema: RestrictionResponseSchema,
          success: [200],
          signal,
        })
      ).data;
      if (value.userId !== id) mismatch();
      return value;
    },
    async reviews(owner: string, state: string, cursor: string | null, signal: AbortSignal) {
      permit('review.read');
      const q = query(
        {
          ...(owner ? { userId: uuid(owner) } : {}),
          ...(state ? { state } : {}),
          ...(cursor !== null ? { cursor } : {}),
        },
        'reviews',
      );
      const value = page(
        (
          await request({
            path: '/admin/v1/reviews?' + q,
            schema: ReviewPageResponseSchema,
            success: [200],
            signal,
          })
        ).data,
        cursor,
      );
      if (
        value.items.some((row) => (owner && row.userId !== owner) || (state && row.state !== state))
      )
        mismatch();
      return value;
    },
    async members(cursor: string | null, signal: AbortSignal) {
      permit('staff.manage');
      return page(
        (
          await request({
            path: '/admin/v1/staff?' + query(cursor !== null ? { cursor } : {}, 'staff'),
            schema: StaffDirectoryResponseSchema,
            success: [200],
            signal,
          })
        ).data,
        cursor,
      );
    },
    async audit(cursor: string | null, signal: AbortSignal) {
      permit('staff.audit.read');
      return page(
        (
          await request({
            path: '/admin/v1/audit-events?' + query(cursor !== null ? { cursor } : {}, 'staff'),
            schema: StaffAuditResponseSchema,
            success: [200],
            signal,
          })
        ).data,
        cursor,
      );
    },
    prepareFlag(target: 'streamer' | 'challenge', id: string, reason: string) {
      permit(permissions.flag);
      const parsed = ReviewFlagSchema.safeParse({ target, targetId: uuid(id), reason });
      if (!parsed.success) return invalid();
      return prepare('flag', null, parsed.data);
    },
    prepareTransition(review: StaffReview, reason: string) {
      permit(permissions.transition);
      const state =
        review.state === 'open' ? 'in_review' : review.state === 'in_review' ? 'resolved' : null;
      const parsed = ReviewTransitionSchema.safeParse({
        state,
        reason,
        expectedVersion: review.revision,
        confirmation: { targetId: review.id, state, expectedVersion: review.revision },
      });
      if (!parsed.success) return invalid();
      return prepare('transition', review.id, parsed.data);
    },
    prepareRestriction(current: StaffRestriction, reason: string) {
      permit(permissions.restriction);
      const action = current.banned ? 'unban' : 'ban';
      const parsed = RestrictionCommandSchema.safeParse({
        action,
        reason,
        expectedVersion: current.revision,
        confirmation: { targetId: current.userId, action, expectedVersion: current.revision },
      });
      if (!parsed.success) return invalid();
      return prepare('restriction', current.userId, parsed.data);
    },
    prepareInvite(
      kind: 'email' | 'subject',
      identity: string,
      role: StaffMember['role'],
      reason: string,
    ) {
      permit(permissions.invite);
      const parsed = StaffInviteInputSchema.safeParse({ [kind]: identity, role, reason });
      if (!parsed.success) return invalid();
      return prepare('invite', null, parsed.data);
    },
    prepareRevokeInvitation(id: string, reason: string) {
      permit(permissions['revoke-invitation']);
      const parsed = StaffReasonInputSchema.safeParse({ reason });
      if (!parsed.success) return invalid();
      return prepare('revoke-invitation', uuid(id), parsed.data);
    },
    prepareMember(member: StaffMember, role: StaffMember['role'] | 'revoke', reason: string) {
      permit(permissions.member);
      if (!member.active || role === member.role) return invalid();
      const parsed = StaffMemberChangeInputSchema.safeParse({
        action: role === 'revoke' ? 'revoke' : 'change_role',
        ...(role === 'revoke' ? {} : { role }),
        reason,
        expectedVersion: member.revision,
      });
      if (!parsed.success) return invalid();
      return prepare('member', member.id, parsed.data);
    },
    async execute(attempt: AdminAttempt): Promise<StaffInvitation | null> {
      active();
      if (!attempts.has(attempt)) return invalid();
      permit(permissions[attempt.kind]);
      if (busy) throw new StaffAdminError(failure('authority', 'COMMAND_IN_PROGRESS'));
      busy = true;
      try {
        const body = attempt.body,
          id = attempt.id;
        const base = {
          method: 'POST' as const,
          body,
          idempotencyKey: attempt.key,
          success: [200] as const,
        };
        if (attempt.kind === 'invite') {
          const value = (
            await request({
              ...base,
              path: '/admin/v1/invitations',
              schema: StaffInvitationResponseSchema,
            })
          ).data;
          if (value.role !== body.role) mismatch();
          if (value.acceptanceUrl !== null) {
            const url = new URL(value.acceptanceUrl),
              hash = new URLSearchParams(url.hash.slice(1));
            if (
              url.origin !== frontendOrigin ||
              url.username ||
              url.password ||
              url.pathname !== '/staff/enrol' ||
              url.search ||
              hash.size !== 1 ||
              !/^[A-Za-z0-9_-]{43}$/.test(hash.get('invitation') ?? '')
            )
              mismatch();
          }
          return value;
        }
        if (attempt.kind === 'revoke-invitation') {
          await request({
            ...base,
            method: 'DELETE',
            path: '/admin/v1/invitations/' + uuid(id ?? ''),
            schema: StaffInvitationRevokedResponseSchema,
          });
        } else if (attempt.kind === 'member') {
          const value = (
            await request({
              ...base,
              path:
                '/admin/v1/staff/' +
                uuid(id ?? '') +
                (body.action === 'revoke' ? '/revocations' : '/role-changes'),
              schema: StaffMemberResponseSchema,
            })
          ).data;
          if (
            value.id !== id ||
            value.revision !== Number(body.expectedVersion) + 1 ||
            (body.action === 'revoke' ? value.active : !value.active || value.role !== body.role)
          )
            mismatch();
        } else if (attempt.kind === 'restriction') {
          const value = (
            await request({
              ...base,
              path: '/admin/v1/streamers/' + uuid(id ?? '') + '/restrictions',
              schema: RestrictionResponseSchema,
            })
          ).data;
          if (
            value.userId !== id ||
            value.revision !== Number(body.expectedVersion) + 1 ||
            value.banned !== (body.action === 'ban')
          )
            mismatch();
        } else {
          const value = (
            await request({
              ...base,
              path:
                '/admin/v1/reviews' +
                (attempt.kind === 'transition' ? '/' + uuid(id ?? '') + '/transitions' : ''),
              schema: ReviewResponseSchema,
            })
          ).data;
          if (
            attempt.kind === 'transition'
              ? value.id !== id ||
                value.state !== body.state ||
                value.revision !== Number(body.expectedVersion) + 1
              : (body.target === 'streamer'
                  ? value.userId !== body.targetId || value.challengeId !== null
                  : value.challengeId !== body.targetId) || value.state !== 'open'
          )
            mismatch();
        }
        return null;
      } finally {
        busy = false;
      }
    },
  };
}
export type StaffAdminClient = ReturnType<typeof createStaffAdminClient>;
