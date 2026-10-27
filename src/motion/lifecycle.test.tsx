import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { SequenceReveal } from './sequence-reveal';
import { useMotionPreference } from './use-motion-preference';

function PreferenceProbe() {
  const reduce = useMotionPreference();
  return <p>{reduce ? 'Still content' : 'Motion allowed'}</p>;
}

function mediaPreference() {
  let reduced = false;
  const records = new Map<string, { listeners: Set<() => void>; media: MediaQueryList }>();
  vi.stubGlobal('matchMedia', (query: string) => {
    const existing = records.get(query);
    if (existing) return existing.media;
    const listeners = new Set<() => void>();
    const media = {
      get matches() {
        return query.includes('no-preference') ? !reduced : reduced;
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_event: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;
    records.set(query, { listeners, media });
    return media;
  });
  return {
    records,
    setReduced(value: boolean) {
      reduced = value;
      records.forEach(({ listeners }) => listeners.forEach((listener) => listener()));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('motion preference lifecycle', () => {
  it('responds to live changes and removes its subscription after StrictMode unmount', () => {
    const media = mediaPreference();
    const view = render(
      <StrictMode>
        <PreferenceProbe />
      </StrictMode>,
    );
    expect(screen.getByText('Motion allowed')).toBeInTheDocument();
    expect(media.records.get('(prefers-reduced-motion: reduce)')?.listeners.size).toBe(1);
    act(() => media.setReduced(true));
    expect(screen.getByText('Still content')).toBeInTheDocument();
    act(() => media.setReduced(false));
    expect(screen.getByText('Motion allowed')).toBeInTheDocument();
    view.unmount();
    expect(media.records.get('(prefers-reduced-motion: reduce)')?.listeners.size).toBe(0);
  });

  it('defaults to still content when preference support is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<PreferenceProbe />);
    expect(screen.getByText('Still content')).toBeInTheDocument();
  });
});

describe('scoped GSAP lifecycle', () => {
  it('creates one tween under StrictMode and reverts interrupted targets on every unmount', () => {
    mediaPreference();
    for (let index = 0; index < 3; index++) {
      const view = render(
        <StrictMode>
          <SequenceReveal>
            <h2>Visible entrance</h2>
          </SequenceReveal>
        </StrictMode>,
      );
      const target = screen.getByRole('heading', { name: 'Visible entrance' }).parentElement;
      expect(target).not.toBeNull();
      if (!target) throw new Error('Missing target');
      const tweens = gsap.getTweensOf(target);
      expect(tweens).toHaveLength(1);
      tweens[0]?.progress(0.3);
      expect(target.style.transform).not.toBe('');
      view.unmount();
      expect(gsap.getTweensOf(target)).toHaveLength(0);
      expect(target.style.transform).toBe('');
    }
  });

  it('keeps content visible without creating a tween when reduced motion is requested', () => {
    const media = mediaPreference();
    media.setReduced(true);
    const view = render(
      <SequenceReveal>
        <h2>Still entrance</h2>
      </SequenceReveal>,
    );
    const target = screen.getByRole('heading', { name: 'Still entrance' }).parentElement;
    if (!target) throw new Error('Missing target');
    expect(gsap.getTweensOf(target)).toHaveLength(0);
    expect(target.style.transform).toBe('');
    expect(target).toBeVisible();
    view.unmount();
  });
});
