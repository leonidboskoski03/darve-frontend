import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { UncertainIdea } from '@/services/suggestions/index';
import { NeedsYourCall } from './needs-your-call';

const idea: UncertainIdea = {
  id: '77889900-1234-4234-8234-112233445566.g3',
  version: 1,
  roundId: '44556677-1234-4234-8234-112233445566',
  resultVersion: '77889900-1234-4234-8234-112233445566',
  analysisRunId: '66778899-1234-4234-8234-112233445566',
  snapshotVersion: 3,
  text: '<b>Take a shot after a death</b>',
  supporterCount: 7,
  reasonCode: 'policy_review_required',
  reasonLabel: 'Might break platform rules — your call',
  state: 'pending',
  selectedChallengeId: null,
};
it('hides an empty private review', () => {
  const { container } = render(
    <NeedsYourCall items={[]} busy={false} canSelect onDecision={vi.fn()} onUse={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});
it('shows private wording, exact text, supporters and Allow/Skip with no public links', () => {
  const decision = vi.fn(),
    use = vi.fn();
  const { container } = render(
    <NeedsYourCall items={[idea]} busy={false} canSelect onDecision={decision} onUse={use} />,
  );
  expect(
    screen.getByRole('heading', { name: 'Needs your call — only you can see this' }),
  ).toBeVisible();
  expect(screen.getByText(idea.text)).toBeVisible();
  expect(container.querySelector('b')).toBeNull();
  expect(screen.getByText('7 supporters · Might break platform rules — your call')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(decision).toHaveBeenLastCalledWith(idea, 'allow');
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(decision).toHaveBeenLastCalledWith(idea, 'skip');
  expect(screen.queryByRole('button', { name: 'Use this challenge' })).toBeNull();
  expect(container.querySelector('a')).toBeNull();
});
it('only offers the existing selection flow for allowed ideas and keeps final decisions final', () => {
  const allowed = { ...idea, state: 'allowed' as const, version: 2 },
    use = vi.fn();
  const { rerender } = render(
    <NeedsYourCall items={[allowed]} busy={false} canSelect onDecision={vi.fn()} onUse={use} />,
  );
  expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Use this challenge' }));
  expect(use).toHaveBeenCalledWith(allowed);
  rerender(
    <NeedsYourCall
      items={[{ ...idea, state: 'skipped', version: 2 }]}
      busy={false}
      canSelect
      onDecision={vi.fn()}
      onUse={use}
    />,
  );
  expect(screen.getByText('Skipped')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});
it('blocks duplicate decisions and competing selections while refreshing or after another selection', () => {
  const { rerender } = render(
    <NeedsYourCall items={[idea]} busy canSelect onDecision={vi.fn()} onUse={vi.fn()} />,
  );
  expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
  rerender(
    <NeedsYourCall
      items={[{ ...idea, state: 'allowed', version: 2 }]}
      busy={false}
      canSelect={false}
      onDecision={vi.fn()}
      onUse={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Use this challenge' })).toBeDisabled();
});
