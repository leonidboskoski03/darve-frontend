import { overlayRemainingSeconds } from '@/services/contracts/index';
import type { RoundRead } from './client';

// Presentation confidence window, not a backend admission/deadline rule.
export const ROUND_DISPLAY_FRESH_MS = 5000;
export const roundIsFresh = (read: RoundRead, now: number) =>
  now >= read.receivedAt && now - read.requestedAt < ROUND_DISPLAY_FRESH_MS;
export function remainingCollectionSeconds(read: RoundRead, now: number) {
  if (!roundIsFresh(read, now) || read.round.state !== 'collecting' || !read.round.closesAt)
    return null;
  return overlayRemainingSeconds(read.round.closesAt, read.serverTime, read.receivedAt, now);
}
export const retainNewerRound = (previous: RoundRead | undefined, next: RoundRead) =>
  previous && previous.round.id === next.round.id && previous.round.version > next.round.version
    ? previous
    : next;
export const isCollectionVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';
export const subscribeCollectionVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};
