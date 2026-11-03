import {
  StaffSupportTicketResponseSchema,
  StaffSupportTicketPageResponseSchema,
  SupportQueuePageResponseSchema,
  SupportAvailabilityResponseSchema,
  SupportMessagePageResponseSchema,
  SupportMutationResponseSchema,
  StaffSupportReplySchema,
  SupportNoteSchema,
  SupportReadSchema,
  SupportStatusCommandSchema,
  SupportAssignmentSchema,
  SupportAvailabilitySchema,
  SupportPageQuerySchema,
  SupportContextSchema,
  SupportRecoveryContextResponseSchema,
  SupportExtensionInputSchema,
  SupportContinuationInputSchema,
  SupportRecoveryResponseSchema,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { StaffAccess } from '@/services/staff-access/index';
export type StaffTicket = ReturnType<typeof StaffSupportTicketResponseSchema.parse>['data'];
export type QueueItem = ReturnType<
  typeof SupportQueuePageResponseSchema.parse
>['data']['items'][number];
export type StaffMessage = ReturnType<
  typeof SupportMessagePageResponseSchema.parse
>['data']['items'][number];
export type Availability = ReturnType<typeof SupportAvailabilityResponseSchema.parse>['data'];
export type RecoveryRead = Readonly<{
  data: ReturnType<typeof SupportRecoveryContextResponseSchema.parse>['data'];
  serverTime: string;
  receivedAt: number;
}>;
export type StaffAttempt = Readonly<{
  kind:
    | 'availability'
    | 'claim'
    | 'reassign'
    | 'reply'
    | 'note'
    | 'read'
    | 'status'
    | 'extension'
    | 'continuation';
  id: string | null;
  key: string;
  body: Readonly<Record<string, unknown>>;
}>;
export class StaffSupportError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Staff support request could not be confirmed.');
  }
}
export const staffSupportUncertain = (error: unknown) =>
  error instanceof StaffSupportError &&
  (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
    (error.problem.status ?? 0) >= 500);
const invalid = (): never => {
  throw new StaffSupportError(failure('configuration', 'INVALID_STAFF_SUPPORT_INPUT'));
};
const mismatch = (): never => {
  throw new StaffSupportError(failure('protocol', 'STAFF_SUPPORT_RESOURCE_MISMATCH'));
};
function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
export function createStaffSupportClient(access: StaffAccess) {
  const scope = access.getSnapshot().scope;
  const receipts = new WeakSet<StaffAttempt>();
  const recoveryReads = new WeakSet<RecoveryRead>();
  const recoveryNow = (read: RecoveryRead) =>
    Date.parse(read.serverTime) + Math.max(0, performance.now() - read.receivedAt);
  let busy = false,
    retryAt = 0;
  const active = () => {
    const current = access.getSnapshot();
    if (scope.signal.aborted || current.scope !== scope || current.phase !== 'authenticated')
      throw new StaffSupportError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const permit = (permission: string) => {
    active();
    if (!access.getSnapshot().permissions.includes(permission))
      throw new StaffSupportError(failure('authority', 'STAFF_PERMISSION_REQUIRED', 403));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    if (retryAt > Date.now())
      throw new StaffSupportError({
        ...failure('http', 'RATE_LIMITED', 429),
        retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000),
      });
    const result = await access.request(input);
    active();
    if (result.kind === 'data') return result.data;
    const problem =
      result.kind === 'error' ? result : failure('protocol', 'INVALID_STAFF_SUPPORT_RESPONSE');
    if ([429, 503].includes(problem.status ?? 0) && problem.retryAfterSeconds !== null)
      retryAt = Date.now() + Math.max(1, problem.retryAfterSeconds) * 1000;
    throw new StaffSupportError(problem);
  };
  const path = (id: string) => {
    if (!SupportContextSchema.safeParse({ kind: 'challenge', id }).success) invalid();
    return '/admin/v1/support/tickets/' + id;
  };
  const query = (cursor: string | null) => {
    const data = { limit: 20, ...(cursor ? { cursor } : {}) };
    if (!SupportPageQuerySchema.safeParse(data).success || cursor === '') invalid();
    return new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) }).toString();
  };
  const prepare = (
    kind: StaffAttempt['kind'],
    id: string | null,
    body: Record<string, unknown>,
  ) => {
    active();
    if (id !== null) path(id);
    const copied = structuredClone(body);
    if (typeof copied.confirmation === 'object' && copied.confirmation)
      Object.freeze(copied.confirmation);
    const attempt = Object.freeze({
      kind,
      id,
      key: crypto.randomUUID(),
      body: Object.freeze(copied),
    });
    receipts.add(attempt);
    return attempt;
  };
  const permission = {
    availability: 'tickets.availability.write',
    claim: 'tickets.queue.read',
    reassign: 'tickets.reassign',
    reply: 'tickets.reply',
    note: 'tickets.note',
    read: 'tickets.assigned.read',
    status: 'tickets.status.write',
    extension: 'tickets.context.write',
    continuation: 'tickets.context.write',
  } as const;
  return {
    scope,
    access,
    retryDelay: () => Math.max(0, retryAt - Date.now()),
    recoveryNow,
    async recovery(
      ticket: StaffTicket,
      challengeId: string,
      signal: AbortSignal,
    ): Promise<RecoveryRead> {
      permit('tickets.context.write');
      if (access.getSnapshot().role !== 'OWNER_ADMIN') invalid();
      if (
        !ticket.contexts.some(
          (context) => context.kind === 'challenge' && context.id === challengeId,
        )
      )
        invalid();
      const value = await request({
        path: path(ticket.id) + '/recovery/' + challengeId,
        schema: SupportRecoveryContextResponseSchema,
        success: [200],
        signal,
      });
      if (value.data.ticketId !== ticket.id || value.data.challengeId !== challengeId) mismatch();
      const context = value.data;
      if (context.state === 'ready') {
        if (
          context.ticketRevision !== ticket.staffRevision ||
          context.contextRevision !== ticket.contextRevision ||
          context.authorityRevision !== ticket.authorityRevision
        )
          throw new StaffSupportError(failure('http', 'CONFLICT', 409));
        if (
          context.performanceRevision !== context.performanceAuthority.revision ||
          new Set(context.replacements.map((row) => row.id)).size !== context.replacements.length ||
          context.replacements.some(
            (row) =>
              row.provider !== context.provider ||
              Date.parse(row.validUntil) <= Date.parse(row.observedAt),
          )
        )
          mismatch();
      }
      const read = Object.freeze({
        data: freezeData(context),
        serverTime: value.serverTime,
        receivedAt: performance.now(),
      });
      recoveryReads.add(read);
      return read;
    },
    prepareRecovery(
      read: RecoveryRead,
      kind: 'extension' | 'continuation',
      input: { reason: string; addedSeconds?: string; replacementId?: string },
    ) {
      permit(permission[kind]);
      if (
        access.getSnapshot().role !== 'OWNER_ADMIN' ||
        !recoveryReads.has(read) ||
        read.data.state !== 'ready'
      )
        return invalid();
      const current = read.data,
        now = recoveryNow(read);
      const common = {
        challengeId: current.challengeId,
        expectedTicketRevision: current.ticketRevision,
        expectedContextRevision: current.contextRevision,
        expectedAuthorityRevision: current.authorityRevision,
        expectedFundingRevision: current.fundingRevision,
        expectedPerformanceRevision: current.performanceRevision,
        reason: input.reason,
      };
      if (kind === 'extension') {
        const window = current.fundingWindow,
          seconds = input.addedSeconds ?? '';
        if (
          !current.extension.available ||
          !window ||
          !/^[1-9][0-9]{0,9}$/.test(seconds) ||
          Date.parse(window.effectiveClosesAt) <= now ||
          Number(seconds) >
            Math.min(
              current.policy.maximumExtensionSeconds,
              current.policy.maximumCumulativeSeconds - window.cumulativeSeconds,
            )
        )
          return invalid();
        const parsed = SupportExtensionInputSchema.safeParse({
          ...common,
          expectedWindowRevision: window.revision,
          addedSeconds: Number(seconds),
          confirmation: {
            challengeId: current.challengeId,
            previousDeadline: window.effectiveClosesAt,
            newDeadline: new Date(
              Date.parse(window.effectiveClosesAt) + Number(seconds) * 1000,
            ).toISOString(),
          },
        });
        if (!parsed.success) return invalid();
        return prepare(kind, current.ticketId, parsed.data);
      }
      const candidate = current.replacements.find((row) => row.id === input.replacementId);
      if (!current.continuation.available || !candidate || now >= Date.parse(candidate.validUntil))
        return invalid();
      const parsed = SupportContinuationInputSchema.safeParse({
        ...common,
        replacementBroadcastId: candidate.id,
        confirmation: {
          challengeId: current.challengeId,
          originalBroadcastId: current.performanceAuthority.originalBroadcastId,
          replacementBroadcastId: candidate.id,
        },
      });
      if (!parsed.success) return invalid();
      return prepare(kind, current.ticketId, parsed.data);
    },
    async availability(signal: AbortSignal) {
      permit('tickets.availability.write');
      return (
        await request({
          path: '/admin/v1/support/availability',
          schema: SupportAvailabilityResponseSchema,
          signal,
          success: [200],
        })
      ).data;
    },
    async page(kind: 'queue' | 'tickets', cursor: string | null, signal: AbortSignal) {
      permit(kind === 'queue' ? 'tickets.queue.read' : 'tickets.assigned.read');
      const url = '/admin/v1/support/' + kind + '?' + query(cursor);
      if (kind === 'queue') {
        const { data } = await request({
          path: url,
          schema: SupportQueuePageResponseSchema,
          signal,
          success: [200],
        });
        if (
          new Set(data.items.map((item) => item.id)).size !== data.items.length ||
          (cursor !== null && data.nextCursor === cursor)
        )
          mismatch();
        return data;
      }
      const { data } = await request({
        path: url,
        schema: StaffSupportTicketPageResponseSchema,
        signal,
        success: [200],
      });
      if (
        new Set(data.items.map((item) => item.id)).size !== data.items.length ||
        (cursor !== null && data.nextCursor === cursor)
      )
        mismatch();
      return data;
    },
    async thread(
      id: string,
      kind: 'messages' | 'notes',
      cursor: string | null,
      signal: AbortSignal,
    ) {
      permit(kind === 'notes' ? 'tickets.note' : 'tickets.assigned.read');
      const url = path(id);
      const before = (
        await request({
          path: url,
          schema: StaffSupportTicketResponseSchema,
          signal,
          success: [200],
        })
      ).data;
      if (before.id !== id) mismatch();
      const page = (
        await request({
          path: url + '/' + kind + '?' + query(cursor),
          schema: SupportMessagePageResponseSchema,
          signal,
          success: [200],
        })
      ).data;
      const ticket = (
        await request({
          path: url,
          schema: StaffSupportTicketResponseSchema,
          signal,
          success: [200],
        })
      ).data;
      if (
        ticket.id !== id ||
        (access.getSnapshot().role === 'SUPPORT' &&
          ticket.assigneeId !== access.getSnapshot().staff?.id)
      )
        mismatch();
      if (
        before.staffRevision !== ticket.staffRevision ||
        before.authorityRevision !== ticket.authorityRevision ||
        before.contextRevision !== ticket.contextRevision
      )
        throw new StaffSupportError(failure('http', 'CONFLICT', 409));
      if (
        new Set(page.items.map((item) => item.id)).size !== page.items.length ||
        page.items.some(
          (item, index, items) =>
            item.sequence < 1 ||
            (index > 0 && item.sequence <= items[index - 1]!.sequence) ||
            item.redacted !== (item.body === null) ||
            (kind === 'notes' && item.author !== 'staff'),
        ) ||
        (cursor !== null && page.nextCursor === cursor)
      )
        mismatch();
      return { ticket, page, kind };
    },
    prepareAvailability(current: Availability, available: boolean) {
      permit(permission.availability);
      const result = SupportAvailabilitySchema.safeParse({
        available,
        expectedRevision: current.revision,
      });
      if (!result.success) return invalid();
      return prepare('availability', null, result.data);
    },
    prepareClaim(item: QueueItem, reason: string) {
      permit(permission.claim);
      const result = SupportAssignmentSchema.safeParse({
        expectedAuthorityRevision: item.authorityRevision,
        reason,
      });
      if (!result.success) return invalid();
      return prepare('claim', item.id, result.data);
    },
    prepareTicket(
      kind: Exclude<StaffAttempt['kind'], 'availability' | 'claim' | 'extension' | 'continuation'>,
      ticket: StaffTicket,
      input: {
        body?: string;
        sequence?: number;
        notes?: boolean;
        status?: StaffTicket['status'];
        reason?: string;
        assigneeId?: string;
        reply?: string;
      },
    ) {
      permit(permission[kind]);
      if (
        access.getSnapshot().role === 'SUPPORT' &&
        ticket.assigneeId !== access.getSnapshot().staff?.id
      )
        invalid();
      const raw =
        kind === 'reply'
          ? {
              body: input.body,
              expectedRevision: ticket.revision,
              expectedAuthorityRevision: ticket.authorityRevision,
            }
          : kind === 'note'
            ? { body: input.body, expectedAuthorityRevision: ticket.authorityRevision }
            : kind === 'read'
              ? { sequence: input.sequence, notes: input.notes ?? false }
              : kind === 'status'
                ? {
                    status: input.status,
                    reason: input.reason,
                    expectedRevision: ticket.revision,
                    expectedAuthorityRevision: ticket.authorityRevision,
                    ...(input.reply?.trim() ? { reply: input.reply } : {}),
                  }
                : {
                    assigneeId: input.assigneeId,
                    reason: input.reason,
                    expectedAuthorityRevision: ticket.authorityRevision,
                  };
      const schema =
        kind === 'reply'
          ? StaffSupportReplySchema
          : kind === 'note'
            ? SupportNoteSchema
            : kind === 'read'
              ? SupportReadSchema
              : kind === 'status'
                ? SupportStatusCommandSchema
                : SupportAssignmentSchema;
      const result = schema.safeParse(raw);
      if (!result.success) return invalid();
      if (kind === 'status' && (ticket.status === 'resolved' || input.status === ticket.status))
        invalid();
      if (kind === 'reassign' && (!input.assigneeId || input.assigneeId === ticket.assigneeId))
        invalid();
      return prepare(kind, ticket.id, result.data);
    },
    async execute(attempt: StaffAttempt) {
      active();
      if (!receipts.has(attempt)) invalid();
      permit(permission[attempt.kind]);
      if (busy) throw new StaffSupportError(failure('authority', 'COMMAND_IN_PROGRESS'));
      busy = true;
      try {
        if (attempt.kind === 'extension' || attempt.kind === 'continuation') {
          if (access.getSnapshot().role !== 'OWNER_ADMIN') return invalid();
          const { data } = await request({
            path:
              path(attempt.id ?? '') +
              (attempt.kind === 'extension' ? '/extensions' : '/continuations'),
            method: 'POST',
            body: attempt.body,
            idempotencyKey: attempt.key,
            schema: SupportRecoveryResponseSchema,
            success: [200],
          });
          if (data.kind !== attempt.kind || data.challengeId !== attempt.body.challengeId)
            mismatch();
          if (attempt.kind === 'extension') {
            const confirmation = SupportExtensionInputSchema.parse(attempt.body).confirmation,
              window = data.authority.fundingWindow;
            if (
              !window ||
              data.revision !== Number(attempt.body.expectedWindowRevision) + 1 ||
              window.revision !== data.revision ||
              window.effectiveClosesAt !== confirmation.newDeadline
            )
              mismatch();
          } else {
            const confirmation = SupportContinuationInputSchema.parse(attempt.body).confirmation,
              authority = data.authority.performanceAuthority;
            if (
              data.revision !== Number(attempt.body.expectedPerformanceRevision) + 1 ||
              authority.revision !== data.revision ||
              authority.originalBroadcastId !== confirmation.originalBroadcastId ||
              authority.broadcastId !== confirmation.replacementBroadcastId
            )
              mismatch();
          }
          return attempt.id;
        }
        const suffix = {
          claim: '/claims',
          reassign: '/reassignments',
          reply: '/messages',
          note: '/notes',
          read: '/read',
          status: '/status',
          availability: '',
        }[attempt.kind];
        const url =
          attempt.id === null ? '/admin/v1/support/availability' : path(attempt.id) + suffix;
        const { data } = await request({
          path: url,
          method: 'POST',
          body: attempt.body,
          idempotencyKey: attempt.key,
          schema: SupportMutationResponseSchema,
          success: [200],
        });
        if (attempt.kind === 'availability') {
          if (
            !('available' in data) ||
            data.available !== attempt.body.available ||
            data.revision !== Number(attempt.body.expectedRevision) + 1
          )
            mismatch();
        } else {
          if (!('ticketId' in data) || data.ticketId !== attempt.id) mismatch();
          if ((attempt.kind === 'reply' || attempt.kind === 'note') && !('messageId' in data))
            mismatch();
          if (
            attempt.kind === 'read' &&
            (!('sequence' in data) || data.sequence < Number(attempt.body.sequence))
          )
            mismatch();
        }
        return attempt.id;
      } finally {
        busy = false;
      }
    },
  };
}
export type StaffSupportClient = ReturnType<typeof createStaffSupportClient>;
