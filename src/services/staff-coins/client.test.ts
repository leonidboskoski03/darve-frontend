import { afterEach, expect, it, vi } from 'vitest';
import {
  createStaffAccess,
  type StaffAccess,
  readStaffEntry,
  staffCoinSearch,
} from '@/services/staff-access/index';
import { createStaffSupportClient } from '@/services/staff-support/index';
import { createStaffCoinClient, StaffCoinError } from './client';
import {
  ids,
  session,
  envelope,
  problem,
  configuration,
  account,
  configurationInput,
  item,
} from './fixture.test-helper';
const authorities: StaffAccess[] = [];
const response = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
async function setup(owner = true) {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(envelope(session(owner))))
    .mockResolvedValueOnce(response(problem('UNAUTHENTICATED'), 401));
  const access = createStaffAccess({
    origin: 'https://staff.example.test',
    frontendOrigin: 'https://staff.example.test',
    authorizationEndpoint: 'https://identity.example.test/authorize',
    fetcher: send,
  });
  authorities.push(access);
  access.start();
  await access.inspect();
  return { access, send, client: createStaffCoinClient(access) };
}
afterEach(() => {
  authorities.splice(0).forEach((value) => value.stop());
  vi.useRealTimers();
});
it('rejects a configuration projection missing its current revision', async () => {
  const { client, send } = await setup();
  send.mockResolvedValueOnce(response({ ...configuration(), configurations: [] }));
  await expect(client.configuration(new AbortController().signal)).rejects.toBeInstanceOf(
    StaffCoinError,
  );
});
it('an acknowledgement with the wrong command state remains unconfirmed', async () => {
  const { client, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'exact target');
  send.mockResolvedValueOnce(
    response({ schemaVersion: 1, data: { revision: 2, state: 'synchronization_pending' } }),
  );
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
});
it('decodes direct configuration/account roots and preserves exact large balances', async () => {
  const { client, send } = await setup();
  send.mockResolvedValueOnce(response(configuration())).mockResolvedValueOnce(response(account()));
  expect((await client.configuration(new AbortController().signal)).revision).toBe(1);
  expect((await client.account(ids.creator, new AbortController().signal)).balance).toBe(
    '9007199254740993',
  );
  send.mockResolvedValueOnce(response(envelope(configuration())));
  await expect(client.configuration(new AbortController().signal)).rejects.toBeInstanceOf(
    StaffCoinError,
  );
});
it('rejects foreign account bindings and malformed catalogue price pairs', async () => {
  const { client, send } = await setup();
  send
    .mockResolvedValueOnce(response({ ...account(), ownerId: ids.owner }))
    .mockResolvedValueOnce(response(envelope({ templates: [{ ...item(), amount: null }] })));
  await expect(client.account(ids.creator, new AbortController().signal)).rejects.toBeInstanceOf(
    StaffCoinError,
  );
  await expect(client.catalogue(new AbortController().signal)).rejects.toBeInstanceOf(
    StaffCoinError,
  );
});
it('denies Support owner reads and commands before transport', async () => {
  const { client, send } = await setup(false);
  await expect(client.configuration(new AbortController().signal)).rejects.toBeInstanceOf(
    StaffCoinError,
  );
  expect(() => client.prepare('configure', ids.program, configurationInput(), 'target')).toThrow();
  expect(send).toHaveBeenCalledTimes(2);
});
it('freezes exact values and rejects foreign confirmation targets before review', async () => {
  const { client } = await setup(),
    input = configurationInput();
  expect(() => client.prepare('configure', ids.owner, input, 'target')).toThrow();
  client.prepare('configure', ids.program, input, 'frozen target');
  input.rewards['suggestions.10'] = '999';
  expect(
    (client.getSnapshot().attempt?.body.rewards as typeof input.rewards)['suggestions.10'],
  ).toBe('10');
  expect(() => client.prepare('configure', ids.program, input, 'replacement')).toThrow();
  client.cancel();
  expect(client.getSnapshot().phase).toBe('idle');
});
it('requires unchecked review before transport and holds same immutable key/body after loss', async () => {
  const { client, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'exact target');
  await expect(client.execute(false)).rejects.toBeInstanceOf(StaffCoinError);
  expect(send).toHaveBeenCalledTimes(2);
  send
    .mockRejectedValueOnce(new TypeError('private response'))
    .mockResolvedValueOnce(
      response({ schemaVersion: 1, data: { revision: 2, state: 'configured' } }),
    );
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
  expect(send).toHaveBeenCalledTimes(3);
  client.cancel();
  expect(client.getSnapshot().phase).toBe('uncertain');
  await client.execute(true);
  const first = send.mock.calls[2]![1]!,
    second = send.mock.calls[3]![1]!;
  expect(first.body).toBe(second.body);
  expect(new Headers(first.headers).get('Idempotency-Key')).toBe(
    new Headers(second.headers).get('Idempotency-Key'),
  );
  expect(new Headers(first.headers).get('X-Staff-CSRF')).toBe('s'.repeat(43));
  expect(new Headers(first.headers).get('X-CSRF-Token')).toBeNull();
  expect(client.getSnapshot().phase).toBe('recorded');
});
it('synchronously blocks duplicate sends while a command is in flight', async () => {
  const { client, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'target');
  let resolve!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = client.execute(true);
  await expect(client.execute(true)).rejects.toBeInstanceOf(StaffCoinError);
  expect(send).toHaveBeenCalledTimes(3);
  resolve(response({ schemaVersion: 1, data: { revision: 2, state: 'configured' } }));
  await pending;
  expect(client.getSnapshot().phase).toBe('recorded');
});
it('definite stale rejection clears held request and requires a fresh review', async () => {
  const { client, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'target');
  send.mockResolvedValueOnce(response(problem(), 409));
  await client.execute(true);
  expect(client.getSnapshot()).toMatchObject({ phase: 'rejected', attempt: null });
  await expect(client.execute(true)).rejects.toBeInstanceOf(StaffCoinError);
});
it('unexpected successful revisions remain uncertain and never create another request', async () => {
  const { client, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'target');
  send.mockResolvedValueOnce(
    response({ schemaVersion: 1, data: { revision: 99, state: 'configured' } }),
  );
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
  expect(send).toHaveBeenCalledTimes(3);
});
it('adjustment acknowledgement is synchronization pending and never fabricates a balance', async () => {
  const { client, send } = await setup();
  client.prepare(
    'adjust',
    ids.creator,
    {
      expectedRevision: 1,
      amount: '10',
      direction: 'debit',
      reason: 'Reviewed',
      confirmation: { ownerId: ids.creator, balance: '9007199254740993' },
    },
    'debit exact amount',
  );
  send.mockResolvedValueOnce(
    response({
      schemaVersion: 1,
      data: { revision: 2, state: 'synchronization_pending', transactionId: ids.ticket },
    }),
  );
  await client.execute(true);
  expect(client.getSnapshot()).toMatchObject({
    phase: 'recorded',
    outcome: 'synchronization_pending',
    attempt: null,
  });
  expect(client.getSnapshot()).not.toHaveProperty('balance');
});
it('zero price is explicit and response must bind exact template and reviewed amount', async () => {
  const { client, send } = await setup();
  client.prepare(
    'price',
    'synthetic_template',
    {
      expectedRevision: 1,
      amount: '0',
      reason: 'Reviewed',
      confirmation: { templateId: 'synthetic_template' },
    },
    'free price',
  );
  send.mockResolvedValueOnce(response(envelope({ templateId: 'other', revision: 2, amount: '0' })));
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
});
it('rate limiting holds the same command and honours its wait without automatic replay', async () => {
  const { client, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'target');
  send.mockResolvedValueOnce(response(problem('RATE_LIMITED'), 429, { 'Retry-After': '2' }));
  await client.execute(true);
  expect(client.getSnapshot().phase).toBe('uncertain');
  expect(client.retryDelay()).toBeGreaterThan(0);
  await client.execute(true);
  expect(send).toHaveBeenCalledTimes(3);
});
it('history rejects repeated opaque cursors and unordered revisions', async () => {
  const { client, send } = await setup();
  send.mockResolvedValueOnce(response(envelope({ items: [], nextCursor: 'same' })));
  await expect(
    client.prices('synthetic_template', 'same', new AbortController().signal),
  ).rejects.toBeInstanceOf(StaffCoinError);
  send.mockResolvedValueOnce(
    response(
      envelope({
        items: [
          { revision: 1, amount: '1', createdAt: '2026-11-05T00:00:00.000Z' },
          { revision: 2, amount: '2', createdAt: '2026-11-05T00:00:00.000Z' },
        ],
        nextCursor: null,
      }),
    ),
  );
  await expect(
    client.prices('synthetic_template', null, new AbortController().signal),
  ).rejects.toBeInstanceOf(StaffCoinError);
});
it('scope disposal clears held input and fences late acknowledgement', async () => {
  const { client, access, send } = await setup();
  client.prepare('configure', ids.program, configurationInput(), 'target');
  let resolve!: (value: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = client.execute(true);
  access.stop();
  resolve(response({ schemaVersion: 1, data: { revision: 2, state: 'configured' } }));
  await pending;
  expect(client.getSnapshot()).toMatchObject({ phase: 'idle', attempt: null });
});
it('assigned Support reads only ticket-bound summary and rejects private fields', async () => {
  const { access, send } = await setup(false),
    client = createStaffSupportClient(access);
  send.mockResolvedValueOnce(
    response(envelope({ balance: '20', progress: 10, progressCap: 1000, templates: [item()] })),
  );
  expect((await client.coins(ids.ticket, new AbortController().signal)).balance).toBe('20');
  expect(send.mock.calls.at(-1)?.[0]).toBe(
    'https://staff.example.test/admin/v1/support/tickets/' + ids.ticket + '/coins',
  );
  send.mockResolvedValueOnce(
    response(
      envelope({ balance: '20', progress: 10, progressCap: 1000, templates: [], ledger: [] }),
    ),
  );
  await expect(client.coins(ids.ticket, new AbortController().signal)).rejects.toThrow();
});
it('staff entry preserves coin route and only safe public navigation fields', () => {
  expect(readStaffEntry('https://staff.example.test/coins?secret=removed').path).toBe('/coins');
  expect(
    staffCoinSearch('?view=account&owner=' + ids.creator + '&secret=removed&cursor=private'),
  ).toBe('?view=account&owner=' + ids.creator);
  expect(staffCoinSearch('?view=prices&template=synthetic_template&template=other')).toBe(
    '?view=prices',
  );
});
