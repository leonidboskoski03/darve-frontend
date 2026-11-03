import {
  SupportTicketResponseSchema,
  SupportTicketPageResponseSchema,
  SupportMessagePageResponseSchema,
  SupportMutationResponseSchema,
  SupportCreateSchema,
  SupportReplySchema,
  SupportReadSchema,
  SupportContextSchema,
  SupportContextCommandSchema,
  SupportPageQuerySchema,
  SupportKeySchema,
} from '@/services/contracts/index';
import { failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';

export type SupportTicket = ReturnType<typeof SupportTicketResponseSchema.parse>['data'];
export type SupportMessage = ReturnType<
  typeof SupportMessagePageResponseSchema.parse
>['data']['items'][number];
export type SupportContext = ReturnType<typeof SupportContextSchema.parse>;
export type SupportAttempt = Readonly<{
  kind: 'create' | 'reply' | 'read' | 'context';
  ticketId: string | null;
  key: string;
  body: Readonly<Record<string, unknown>>;
}>;
export class SupportError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Support request could not be confirmed.');
  }
}
export const uncertainSupport = (error: unknown) =>
  error instanceof SupportError &&
  (['network', 'timeout', 'protocol'].includes(error.problem.category) ||
    (error.problem.status ?? 0) >= 500);
const invalid = (): never => {
  throw new SupportError(failure('configuration', 'INVALID_SUPPORT_INPUT'));
};
const mismatch = (): never => {
  throw new SupportError(failure('protocol', 'SUPPORT_RESOURCE_MISMATCH'));
};
export function createSupportClient(session: CreatorSession) {
  const scope = session.getSnapshot().scope;
  const attempts = new WeakSet<SupportAttempt>();
  let commanding = false;
  let retryAt = 0;
  const active = () => {
    if (
      scope.signal.aborted ||
      session.getSnapshot().scope !== scope ||
      session.getSnapshot().phase !== 'authenticated'
    )
      throw new SupportError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    if (Date.now() < retryAt)
      throw new SupportError({
        ...failure('http', 'RATE_LIMITED', 429),
        retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000),
      });
    const result = await session.request(input);
    active();
    if (result.kind === 'data') return result.data;
    const problem =
      result.kind === 'error' ? result : failure('protocol', 'INVALID_SUPPORT_RESPONSE');
    if ((problem.status === 429 || problem.status === 503) && problem.retryAfterSeconds !== null)
      retryAt = Date.now() + Math.max(1, problem.retryAfterSeconds) * 1000;
    throw new SupportError(problem);
  };
  const path = (id: string) => {
    if (!SupportContextSchema.safeParse({ kind: 'challenge', id }).success) invalid();
    return '/api/support/tickets/' + id;
  };
  const pageQuery = (cursor: string | null) => {
    const query = { limit: 20, ...(cursor ? { cursor } : {}) };
    if (!SupportPageQuerySchema.safeParse(query).success || cursor === '') invalid();
    return new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
  };
  const prepare = (
    kind: SupportAttempt['kind'],
    id: string | null,
    body: Record<string, unknown>,
  ) => {
    active();
    if (id !== null) path(id);
    const key = crypto.randomUUID();
    SupportKeySchema.parse(key);
    // Clone and freeze the exact reviewed request; later draft edits cannot change a retry.
    const copied: Record<string, unknown> = structuredClone(body);
    if ('context' in copied && typeof copied.context === 'object' && copied.context !== null)
      Object.freeze(copied.context);
    if (Array.isArray(copied.contexts)) {
      copied.contexts.forEach(Object.freeze);
      Object.freeze(copied.contexts);
    }
    const attempt = Object.freeze({ kind, ticketId: id, key, body: Object.freeze(copied) });
    attempts.add(attempt);
    return attempt;
  };
  return {
    scope,
    session,
    retryDelay: () => Math.max(0, retryAt - Date.now()),
    async tickets(cursor: string | null, signal: AbortSignal) {
      const { data } = await request({
        path: '/api/support/tickets?' + pageQuery(cursor).toString(),
        schema: SupportTicketPageResponseSchema,
        signal,
        success: [200],
      });
      if (
        new Set(data.items.map((item) => item.id)).size !== data.items.length ||
        (data.nextCursor === cursor && cursor !== null)
      )
        mismatch();
      return data;
    },
    async thread(id: string, cursor: string | null, signal: AbortSignal) {
      const url = path(id);
      const { data: before } = await request({
        path: url,
        schema: SupportTicketResponseSchema,
        signal,
        success: [200],
      });
      if (before.id !== id) mismatch();
      const { data: messages } = await request({
        path: url + '/messages?' + pageQuery(cursor).toString(),
        schema: SupportMessagePageResponseSchema,
        signal,
        success: [200],
      });
      const { data: ticket } = await request({
        path: url,
        schema: SupportTicketResponseSchema,
        signal,
        success: [200],
      });
      if (ticket.id !== id) mismatch();
      if (before.revision !== ticket.revision || before.contextRevision !== ticket.contextRevision)
        throw new SupportError(failure('http', 'CONFLICT', 409));
      if (
        new Set(messages.items.map((item) => item.id)).size !== messages.items.length ||
        messages.items.some(
          (item, index, items) =>
            item.sequence < 1 ||
            (index > 0 && item.sequence <= items[index - 1]!.sequence) ||
            item.redacted !== (item.body === null),
        ) ||
        (messages.nextCursor === cursor && cursor !== null)
      )
        mismatch();
      return { ticket, messages };
    },
    prepareCreate(raw: unknown) {
      const parsed = SupportCreateSchema.safeParse(raw);
      if (!parsed.success) return invalid();
      return prepare('create', null, parsed.data);
    },
    prepareReply(ticket: SupportTicket, body: string) {
      const parsed = SupportReplySchema.safeParse({ body, expectedRevision: ticket.revision });
      if (!parsed.success) return invalid();
      return prepare('reply', ticket.id, parsed.data);
    },
    prepareRead(ticket: SupportTicket, sequence: number) {
      const parsed = SupportReadSchema.safeParse({ sequence, notes: false });
      if (!parsed.success) return invalid();
      return prepare('read', ticket.id, parsed.data);
    },
    prepareContext(
      ticket: SupportTicket,
      context: SupportContext,
      operation: 'add' | 'revoke',
      reason: string,
    ) {
      const parsed = SupportContextCommandSchema.safeParse({
        context,
        operation,
        reason,
        expectedContextRevision: ticket.contextRevision,
      });
      if (!parsed.success) return invalid();
      return prepare('context', ticket.id, parsed.data);
    },
    async execute(attempt: SupportAttempt) {
      active();
      if (!attempts.has(attempt)) invalid();
      if (commanding) throw new SupportError(failure('authority', 'COMMAND_IN_PROGRESS'));
      commanding = true;
      try {
        const suffix = { reply: '/messages', read: '/read', context: '/context-links', create: '' }[
          attempt.kind
        ];
        const { data } = await request({
          path:
            (attempt.ticketId === null ? '/api/support/tickets' : path(attempt.ticketId)) + suffix,
          method: 'POST',
          body: attempt.body,
          idempotencyKey: attempt.key,
          schema: SupportMutationResponseSchema,
          success: [200],
        });
        if (
          !('ticketId' in data) ||
          (attempt.ticketId !== null && data.ticketId !== attempt.ticketId)
        )
          mismatch();
        if ((attempt.kind === 'create' || attempt.kind === 'reply') && !('messageId' in data))
          mismatch();
        if (
          attempt.kind === 'read' &&
          (!('sequence' in data) || data.sequence < Number(attempt.body.sequence))
        )
          mismatch();
        if (!('ticketId' in data)) return mismatch();
        return data;
      } finally {
        commanding = false;
      }
    },
  };
}
export type SupportClient = ReturnType<typeof createSupportClient>;
