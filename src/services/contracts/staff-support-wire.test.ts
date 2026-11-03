import { describe, expect, it, vi } from 'vitest';
import { createJsonClient } from '@/services/api/index';
import {
  StaffAuthorizationStartResponseSchema,
  StaffSessionResponseSchema,
  StaffEmailCodeStatusResponseSchema,
  StaffEmailCodeVerifiedResponseSchema,
  StaffLogoutResponseSchema,
  SupportTicketResponseSchema,
  StaffSupportTicketResponseSchema,
  SupportMessagePageResponseSchema,
  SupportLiveEventSchema,
  StaffSupportLiveEventSchema,
  RestrictionCommandSchema,
  ReviewFlagSchema,
  ReviewTransitionSchema,
  ReviewPageQuerySchema,
} from './index';

const id = '12345678-1234-4234-8234-123456789012';
const at = '2026-11-03T12:00:00.000Z';
const envelope = (data: unknown) => ({ schemaVersion: 1, serverTime: at, data });
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
describe('pinned F08 browser contracts', () => {
  it('reads the distinct staff envelope and rejects a creator session projection', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(envelope({ state: 'signed_out' })))
      .mockResolvedValueOnce(
        response({ authenticated: false, user: null, expiresAt: null, csrfToken: null }),
      );
    const client = createJsonClient({
      audience: 'staff',
      origin: 'https://staff.example.test',
      fetcher: send,
    });
    const input = {
      path: '/admin/v1/session',
      schema: StaffSessionResponseSchema,
      success: [200] as const,
    };
    expect(await client(input)).toMatchObject({
      kind: 'data',
      data: { data: { state: 'signed_out' } },
    });
    expect(await client(input)).toMatchObject({ category: 'protocol' });
  });
  it('retains pending/enrollment distinctions and literal logout without creator start fields', () => {
    const start = envelope({ authorizationUrl: 'https://staff.example.test/authorize' });
    expect(StaffAuthorizationStartResponseSchema.safeParse(start).success).toBe(true);
    expect(
      StaffAuthorizationStartResponseSchema.safeParse({
        ...start,
        data: { authorizationUrl: 'https://staff.example.test/authorize', expiresAt: at },
      }).success,
    ).toBe(false);
    expect(
      StaffEmailCodeStatusResponseSchema.parse(
        envelope({ state: 'email_code_pending', expiresAt: at, csrfToken: 'a'.repeat(43) }),
      ).data.state,
    ).toBe('email_code_pending');
    expect(
      StaffEmailCodeVerifiedResponseSchema.parse(
        envelope({ state: 'enrollment_pending', returnPath: '/staff/enrol' }),
      ).data.state,
    ).toBe('enrollment_pending');
    expect(StaffLogoutResponseSchema.safeParse(envelope({ signedOut: true })).success).toBe(true);
    expect(StaffLogoutResponseSchema.safeParse(envelope({ signedOut: false })).success).toBe(false);
  });
  it('rejects staff-only ticket fields at the creator transport boundary and retains redaction', async () => {
    const ticket = {
      id,
      category: 'stream',
      status: 'open',
      revision: 1,
      contextRevision: 0,
      createdAt: at,
      updatedAt: at,
      contexts: [],
      unread: 0,
      readSequence: 0,
    };
    const staff = {
      ...ticket,
      ownerId: id,
      assigneeId: null,
      authorityRevision: 1,
      staffRevision: 2,
      noteUnread: 1,
      noteReadSequence: 0,
    };
    expect(StaffSupportTicketResponseSchema.safeParse(envelope(staff)).success).toBe(true);
    const send = vi.fn<typeof fetch>().mockResolvedValue(response(envelope(staff)));
    const creator = createJsonClient({
      audience: 'creator',
      origin: 'https://api.example.test',
      fetcher: send,
    });
    expect(
      await creator({
        path: '/api/support/tickets/' + id,
        schema: SupportTicketResponseSchema,
        success: [200],
      }),
    ).toMatchObject({ category: 'protocol' });
    const page = SupportMessagePageResponseSchema.parse(
      envelope({
        items: [{ id, sequence: 1, author: 'staff', body: null, createdAt: at, redacted: true }],
        nextCursor: null,
      }),
    );
    expect(page.data.items[0]?.body).toBeNull();
    expect(
      SupportMessagePageResponseSchema.safeParse({
        ...page,
        data: { ...page.data, internalNotes: [] },
      }).success,
    ).toBe(false);
  });
  it('validates support hints separately from staff notes, message text and OBS events', () => {
    const data = { ticketId: id, revision: 2, readSequence: 0, unread: 1 };
    const staff = { event: 'changed', data: { ...data, noteReadSequence: 0, noteUnread: 1 } };
    expect(StaffSupportLiveEventSchema.safeParse(staff).success).toBe(true);
    expect(SupportLiveEventSchema.safeParse(staff).success).toBe(false);
    for (const event of ['changed', 'resync_required', 'heartbeat'])
      expect(SupportLiveEventSchema.safeParse({ event, data }).success).toBe(true);
    for (const value of [
      { event: 'overlay.snapshot', data },
      { event: 'changed', data: { ...data, body: 'private' } },
      { event: 'changed', data, id: 'cursor' },
    ])
      expect(SupportLiveEventSchema.safeParse(value).success).toBe(false);
  });
  it('requires exact moderation confirmation structure and bounded public queries', () => {
    expect(
      ReviewFlagSchema.parse({ target: 'streamer', targetId: id, reason: ' review ' }).reason,
    ).toBe('review');
    expect(
      RestrictionCommandSchema.safeParse({ action: 'ban', expectedVersion: 0, reason: 'review' })
        .success,
    ).toBe(false);
    expect(
      ReviewTransitionSchema.safeParse({
        state: 'resolved',
        expectedVersion: 1,
        reason: 'review',
        confirmation: { targetId: id, state: 'resolved', expectedVersion: 1 },
      }).success,
    ).toBe(true);
    expect(
      ReviewTransitionSchema.safeParse({
        state: 'resolved',
        expectedVersion: 0,
        reason: 'review',
        confirmation: { targetId: id, state: 'resolved', expectedVersion: 0 },
      }).success,
    ).toBe(false);
    expect(ReviewPageQuerySchema.parse({ limit: '2', state: 'open' }).limit).toBe(2);
    expect(ReviewPageQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
  it('accepts normalized staff rate-limit metadata without replay and rejects the old minimal body', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          {
            schemaVersion: 1,
            serverTime: at,
            error: {
              code: 'RATE_LIMITED',
              message: 'private-message-marker',
              requestId: 'synthetic-request',
              retryable: true,
              retryAfterSeconds: 60,
              issues: [],
              refetch: null,
            },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(response({ error: { code: 'RATE_LIMITED' } }, 429));
    const client = createJsonClient({
      audience: 'staff',
      origin: 'https://staff.example.test',
      fetcher: send,
    });
    const input = {
      path: '/admin/v1/session',
      schema: StaffSessionResponseSchema,
      success: [200] as const,
    };
    const result = await client(input);
    expect(result).toMatchObject({
      category: 'http',
      action: 'retry',
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    });
    expect(JSON.stringify(result)).not.toContain('private-message-marker');
    expect(send).toHaveBeenCalledOnce();
    expect(await client(input)).toMatchObject({ category: 'protocol', action: 'protocol_error' });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
