import { afterEach, expect, it, vi } from 'vitest';
import { createCreatorSession, type CreatorSession } from '@/services/creator-session/index';
import { syntheticTemplateSession } from './fixture.test-helper';
import { createTemplateSelectionClient } from './selection';
import { TemplateError, type TemplateResources } from './client';
const envelope = (data: unknown) => ({
  schemaVersion: 1,
  serverTime: '2026-11-04T12:00:00.000Z',
  data,
});
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const selected = (id = 'standalone', revision = 123) =>
  envelope({
    templateId: id,
    revision,
    assetVersion: 1,
    available: true,
    renderer: { key: 'standalone', hash: null },
  });
const resources = () =>
  ({
    account: envelope({
      revision: 7,
      balance: '100',
      spendableBalance: '100',
      state: 'synchronized',
      redemptionAllowed: true,
    }),
    catalogue: envelope({
      templates: [
        {
          id: 'darve_compact',
          displayName: 'Darve Compact',
          assetVersion: 1,
          amount: '10',
          priceRevision: 1,
          owned: true,
          available: true,
          ownershipState: 'owned',
        },
      ],
    }),
    entitlements: envelope({
      templates: [
        {
          id: 'darve_compact',
          displayName: 'Darve Compact',
          assetVersion: 1,
          amount: '10',
          priceRevision: 1,
          owned: true,
          available: true,
          ownershipState: 'owned',
        },
      ],
    }),
  }) as TemplateResources;
const sessions: CreatorSession[] = [];
async function setup() {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(json(syntheticTemplateSession));
  const session = createCreatorSession({ origin: 'https://api.example.test', fetcher: send });
  sessions.push(session);
  session.start();
  await session.inspect();
  const client = createTemplateSelectionClient(
    session,
    (id, version) => id === 'darve_compact' && version === 1,
  );
  send.mockResolvedValueOnce(json(selected()));
  const selection = await client.read(new AbortController().signal);
  return { send, session, client, selection };
}
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions.length = 0;
});
it('uses independent template revision, fresh confirmation and no replay key or layout fields', async () => {
  const { send, client, selection } = await setup();
  client.prepare(resources(), selection, 'darve_compact');
  await expect(client.select(false)).rejects.toBeInstanceOf(TemplateError);
  send.mockResolvedValueOnce(json(selected('darve_compact', 124)));
  await client.select(true);
  expect(client.getSnapshot().phase).toBe('unconfirmed');
  expect(JSON.parse(send.mock.calls[2]![1]!.body as string)).toEqual({
    expectedRevision: 123,
    templateId: 'darve_compact',
  });
  expect(new Headers(send.mock.calls[2]![1]!.headers).has('Idempotency-Key')).toBe(false);
  send.mockResolvedValueOnce(json(selected('darve_compact', 124)));
  await client.read(new AbortController().signal);
  expect(client.getSnapshot().phase).toBe('confirmed');
});
it.each(['network', 'malformed', 'wrong-target'])(
  'never replays %s and requires canonical read before a new decision',
  async (mode) => {
    const { send, client, selection, session } = await setup();
    client.prepare(resources(), selection, 'darve_compact');
    if (mode === 'network') send.mockRejectedValueOnce(new TypeError());
    else send.mockResolvedValueOnce(json(mode === 'malformed' ? {} : selected('other', 124)));
    await client.select(true);
    expect(createTemplateSelectionClient(session, () => false)).toBe(client);
    await expect(client.select(true)).rejects.toBeInstanceOf(TemplateError);
    expect(() => client.prepare(resources(), selection, 'darve_compact')).toThrow(TemplateError);
    expect(send).toHaveBeenCalledTimes(3);
    send.mockResolvedValueOnce(json(selected('standalone', 125)));
    const fresh = await client.read(new AbortController().signal);
    expect(client.getSnapshot().phase).toBe('checked');
    client.prepare(resources(), fresh, 'darve_compact');
    expect(client.getSnapshot().attempt!.input.expectedRevision).toBe(125);
    await expect(client.select(false)).rejects.toBeInstanceOf(TemplateError);
  },
);
it.each(['not-owned', 'pending', 'unavailable', 'unknown-version', 'already-selected'])(
  'prevents %s selection before sending',
  async (mode) => {
    const { send, client, selection } = await setup(),
      data = resources();
    if (mode === 'not-owned') data.entitlements.data.templates = [];
    if (mode === 'pending')
      data.entitlements.data.templates[0]!.ownershipState = 'synchronization_pending';
    if (mode === 'unavailable') data.catalogue.data.templates[0]!.available = false;
    if (mode === 'unknown-version') data.catalogue.data.templates[0]!.assetVersion = 2;
    if (mode === 'already-selected') selection.data.templateId = 'darve_compact';
    expect(() => client.prepare(data, selection, 'darve_compact')).toThrow(TemplateError);
    expect(send).toHaveBeenCalledTimes(2);
  },
);
it('locks concurrent submits and clears intent/late results on authority loss', async () => {
  const { send, client, selection, session } = await setup();
  client.prepare(resources(), selection, 'darve_compact');
  let settle!: (response: Response) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const running = client.select(true);
  await expect(client.select(true)).rejects.toBeInstanceOf(TemplateError);
  session.stop();
  settle(json(selected('darve_compact', 124)));
  await running;
  expect(client.getSnapshot().phase).toBe('idle');
  expect(client.getSnapshot().attempt).toBeNull();
  await expect(client.select(true)).rejects.toBeInstanceOf(TemplateError);
});
