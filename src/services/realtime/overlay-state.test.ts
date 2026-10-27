import { describe, expect, it } from 'vitest';
import {
  createOverlayState,
  applySnapshot,
  applyEvent,
  disconnectOverlay,
  overlayView,
} from './overlay-state';
import {
  displayId,
  foreignId,
  makeFrame,
  makeEvent,
  acceptedFrame,
  iso,
} from './fixtures.test-support';

describe.each([1, 2] as const)('overlay protocol %s consumer', (protocol) => {
  const initial = () =>
    applySnapshot(createOverlayState(displayId, protocol), makeFrame(protocol), 100);
  it('rejects gaps, preserves version floors across disconnect and rejects delayed bootstrap', () => {
    let state = initial();
    state = applyEvent(state, makeEvent(makeFrame(protocol, 3, 2), 'overlay.changed'), 200);
    expect(state).toMatchObject({ frame: null, needsRefetch: true, versionFloor: 3 });
    state = disconnectOverlay(state);
    expect(applySnapshot(state, makeFrame(protocol, 2, 3), 300)).toBe(state);
    state = applySnapshot(state, makeFrame(protocol, 3, 3), 300);
    expect(state.frame?.data.version).toBe(3);
    expect(applySnapshot(state, makeFrame(protocol, 1, 4), 400)).toBe(state);
  });
  it('ignores duplicate/stale changes, foreign resources and non-advancing clocks without renewing freshness', () => {
    const state = initial();
    const duplicate = makeEvent(makeFrame(protocol), 'overlay.changed');
    expect(applyEvent(state, duplicate, 500)).toBe(state);
    const foreign = makeFrame(protocol, 2, 2);
    foreign.data.id = foreignId;
    expect(applyEvent(state, makeEvent(foreign), 500)).toBe(state);
    expect(applyEvent(state, makeEvent(makeFrame(protocol)), 1000)).toBe(state);
    expect(overlayView(state, 15_101, true).snapshot).toBeNull();
  });
  it('accepts advancing same-version heartbeat and hides altered duplicate data until authoritative refresh', () => {
    let state = initial();
    state = applyEvent(state, makeEvent(makeFrame(protocol, 1, 1)), 500);
    expect(state.receivedAtMs).toBe(500);
    const altered = makeFrame(protocol, 1, 2);
    altered.data.preferences.styles.opacity = 0.5;
    state = applyEvent(state, makeEvent(altered, 'overlay.changed'), 600);
    expect(state.needsRefetch).toBe(true);
    expect(overlayView(state, 600, true).snapshot).toBeNull();
  });
  it('resync requires authoritative HTTP data without allowing an older chronology to restore content', () => {
    let state = initial();
    state = applyEvent(state, makeEvent(makeFrame(protocol, 2, 10), 'resync_required'), 200);
    expect(state).toMatchObject({ frame: null, versionFloor: 2, needsRefetch: true });
    expect(applySnapshot(state, makeFrame(protocol, 2, 9), 300)).toBe(state);
    state = applySnapshot(state, makeFrame(protocol, 2, 11), 400);
    expect(state.needsRefetch).toBe(false);
    state = applySnapshot(state, makeFrame(protocol, 3, 8), 500);
    expect(state).toMatchObject({ frame: null, versionFloor: 3 });
  });
  it('hides malformed/private/wrong-protocol frames and mismatched cursors', () => {
    const state = initial();
    for (const input of [
      { ...makeFrame(protocol), secret: 'never-render' },
      makeFrame(protocol === 1 ? 2 : 1),
    ])
      expect(applySnapshot(state, input, 200).frame).toBeNull();
    const event = makeEvent(makeFrame(protocol, 2, 1));
    event.eventId = `${displayId}.v99`;
    expect(applyEvent(state, event, 200).frame).toBeNull();
  });
  it('replaces removed content atomically and rejects late frames that could restore its wording or QR', () => {
    const accepted = acceptedFrame(protocol);
    let state = applySnapshot(createOverlayState(displayId, protocol), accepted, 100);
    const removed = makeFrame(protocol, 2, 2);
    removed.data.presentationState = 'restricted';
    state = applyEvent(state, makeEvent(removed, 'overlay.changed'), 200);
    expect(overlayView(state, 200, true)).toMatchObject({
      snapshot: { presentationState: 'restricted', challenge: null, qrPayload: null },
    });
    state = applySnapshot(state, { ...accepted, serverTime: iso(3) }, 300);
    state = applyEvent(state, makeEvent(accepted, 'overlay.changed'), 400);
    expect(JSON.stringify(overlayView(state, 400, true))).not.toContain('Synthetic challenge');
    expect(overlayView(state, 400, true).presentation?.qrPayload).toBeNull();
  });
  it('keeps exact totals, QR identity, immutable deadlines and monotonic 15-second freshness', () => {
    const frame = acceptedFrame(protocol);
    let state = applySnapshot(createOverlayState(displayId, protocol), frame, 100);
    let view = overlayView(state, 1100, true);
    expect(view.presentation?.qrPayload).toBe('https://example.test/c/synthetic');
    expect(view.snapshot?.challenge?.funding.confirmedGross).toBe('9007199254740992');
    expect(view.presentation?.fundingSeconds).toBe(59);
    expect(overlayView(state, 15_101, true).snapshot).toBeNull();
    expect(overlayView(state, 99, true).snapshot).toBeNull();
    expect(overlayView(state, 100, false).snapshot).toBeNull();
    const later = { ...frame, serverTime: iso(60) };
    state = applySnapshot(state, later, 200);
    view = overlayView(state, 200, true);
    expect(view.presentation?.fundingSeconds).toBe(0);
    expect(view.presentation?.qrPayload).toBeNull();
    expect(view.snapshot?.challenge?.terms.fundingClosesAt).toBe(iso(60));
  });
});

it('preserves v2 template identity/availability and never coerces it into legacy styles', () => {
  const frame = acceptedFrame(2);
  if (frame.schemaVersion !== 2) throw new Error('Wrong fixture.');
  frame.data.preferences.template = {
    revision: 4,
    templateId: 'premium',
    assetVersion: 8,
    available: false,
    renderer: null,
  };
  const state = applySnapshot(createOverlayState(displayId, 2), frame, 100);
  const view = overlayView(state, 100, true);
  expect(view.snapshot?.preferences).toMatchObject({ template: frame.data.preferences.template });
  expect(view.presentation?.qrPayload).toBeNull();
  expect(view.snapshot?.preferences.styles).not.toHaveProperty('themeStyle');
});
