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
export type StaffAttempt = Readonly<{
  kind: 'availability' | 'claim' | 'reassign' | 'reply' | 'note' | 'read' | 'status';
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
export function createStaffSupportClient(access: StaffAccess) {
  const scope = access.getSnapshot().scope;
  const receipts = new WeakSet<StaffAttempt>();
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
  } as const;
  return {
    scope,
    access,
    retryDelay: () => Math.max(0, retryAt - Date.now()),
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
      kind: Exclude<StaffAttempt['kind'], 'availability' | 'claim'>,
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
