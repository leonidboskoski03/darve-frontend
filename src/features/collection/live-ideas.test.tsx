import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createAuthorityScope, type AuthorityScope } from '@/services/server-state/index';
import { CollectionLiveIdeas } from './live-ideas';

// Minimal server frames (the services layer owns the full stream fixtures).
const roundId = '10000000-0000-4000-8000-000000000001';
const idea = (order: number, supporterCount = 20 - order, title = `Idea ${order}`) => ({
  id: order.toString(16).padStart(32, 'a'),
  title,
  supporterCount,
  order,
});
const state = (value: string) => ({ type: 'round-state', roundId, state: value });
const preview = (...suggestions: ReturnType<typeof idea>[]) => ({
  type: 'preview',
  roundId,
  label: 'live preview, not final',
  suggestions,
});
const publishedEvent = (settling: boolean, provisional = false) => ({
  type: 'published',
  roundId,
  resultVersion: '20000000-0000-4000-8000-000000000002',
  provisional,
  settling,
  suggestions: [1, 2, 3].map((order) => ({
    id: `g${order}`,
    title: `Final ${order}`,
    supporterCount: 30 - order,
    order,
    reason: `Reason ${order}`,
  })),
});
let sequence = 0;
const wire = (event: { type: string }) =>
  `id: ${(++sequence).toString(16).padStart(64, '0')}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const encoder = new TextEncoder();
const scopes: AuthorityScope[] = [];
function serve() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  // The panel uses the services adapter, which reads the global network function.
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } })),
  );
  const scope = createAuthorityScope('creator');
  scopes.push(scope);
  render(<CollectionLiveIdeas origin="https://api.example.test" scope={scope} roundId={roundId} />);
  return async (text: string) => {
    await act(async () => {
      controller.enqueue(encoder.encode(text));
      for (let count = 0; count < 40; count++) await Promise.resolve();
    });
  };
}
afterEach(() => {
  scopes.forEach((scope) => scope.dispose());
  scopes.length = 0;
  vi.unstubAllGlobals();
});

it('labels the countdown list as a live preview and renders viewer text as text', async () => {
  const send = serve();
  await send(wire(state('open')) + wire(preview(idea(1, 12, '<b>win 10 rounds</b>'), idea(2, 7))));
  expect(screen.getByRole('heading', { name: 'Top ideas right now' })).toBeVisible();
  expect(screen.getByText('Live preview, not final')).toBeVisible();
  const list = screen.getByRole('list', { name: 'Live preview of top ideas' });
  expect(list.querySelectorAll('li')).toHaveLength(2);
  expect(screen.getByText('<b>win 10 rounds</b>')).toBeVisible();
  expect(list.querySelector('b')).toBeNull();
  expect(screen.getByLabelText('12 supporters')).toBeVisible();
  expect(screen.queryByRole('link', { name: /Review and accept/ })).toBeNull();
});

it('shows the waiting state before any idea is checked', async () => {
  const send = serve();
  await send(wire(state('open')) + wire(preview()));
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for the first ideas');
});

it('replaces the preview with the final top ten, reasons and the review link', async () => {
  const send = serve();
  await send(wire(state('open')) + wire(preview(idea(1))));
  await send(wire(state('closing')));
  expect(screen.getByRole('status')).toHaveTextContent('Picking the top 10');
  await send(wire(state('published')) + wire(publishedEvent(true)));
  expect(screen.getByRole('heading', { name: 'Top 10 ideas' })).toBeVisible();
  expect(screen.queryByText('Live preview, not final')).toBeNull();
  expect(screen.getByText('Reason 1')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Supporter counts are still updating');
  expect(screen.getByRole('link', { name: 'Review and accept a challenge' })).toHaveAttribute(
    'href',
    `/collection/${roundId}/suggestions`,
  );
});

it('marks a provisional result', async () => {
  const send = serve();
  await send(wire(state('provisional')) + wire(publishedEvent(false, true)));
  expect(screen.getByText('Provisional')).toBeVisible();
  expect(screen.getByText(/already checked when the round closed/)).toBeVisible();
});

it('clears visible ideas when the round fails', async () => {
  const send = serve();
  await send(wire(state('open')) + wire(preview(idea(1))));
  await send(wire(state('failed')));
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Analysis could not finish');
});
