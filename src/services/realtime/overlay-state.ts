import {
  OverlaySnapshotV2ResponseSchema,
  OverlayEventV2Schema,
  createOverlayConsumer,
  applyOverlayConsumerSnapshot,
  applyOverlayConsumerEvent,
  disconnectOverlayConsumer,
  overlayConsumerView,
  overlayRemainingSeconds,
  type OverlayConsumerState,
  type OverlaySnapshotResponse,
} from '@/services/contracts/index';

type V2Frame = ReturnType<typeof OverlaySnapshotV2ResponseSchema.parse>;
type V2State = Omit<OverlayConsumerState, 'frame'> & { protocol: 2; frame: V2Frame | null };
export type OverlayState = ({ protocol: 1 } & OverlayConsumerState) | V2State;
export type OverlayFrame = OverlaySnapshotResponse | V2Frame;

export function createOverlayState(displayId: string, protocol: 1 | 2): OverlayState {
  return { ...createOverlayConsumer(displayId), protocol, frame: null };
}
export function disconnectOverlay(state: OverlayState): OverlayState {
  if (state.protocol === 1) return { ...disconnectOverlayConsumer(state), protocol: 1 };
  return { ...state, frame: null, receivedAtMs: null, needsRefetch: true };
}

/** V1 delegates to the pinned reducer. V2 retains its entire strict frame, including template selection. */
export function applySnapshot(
  state: OverlayState,
  input: unknown,
  receivedAtMs: number,
): OverlayState {
  if (state.protocol === 1) {
    const next = applyOverlayConsumerSnapshot(state, input, receivedAtMs);
    return next === state ? state : { ...next, protocol: 1 };
  }
  const parsed = OverlaySnapshotV2ResponseSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(receivedAtMs) || receivedAtMs < 0)
    return disconnectOverlay(state);
  const frame = parsed.data,
    serverMs = Date.parse(frame.serverTime);
  if (frame.data.id !== state.displayId || frame.data.version < state.versionFloor) return state;
  if (
    state.serverTimeFloorMs !== null &&
    serverMs < state.serverTimeFloorMs &&
    frame.data.version > state.versionFloor
  )
    return disconnectOverlay({ ...state, versionFloor: frame.data.version });
  if (
    state.serverTimeFloorMs !== null &&
    (serverMs < state.serverTimeFloorMs || (!state.frame && serverMs === state.serverTimeFloorMs))
  )
    return state;
  const previous = state.frame;
  if (previous) {
    if (
      serverMs < Date.parse(previous.serverTime) ||
      (state.receivedAtMs !== null && receivedAtMs < state.receivedAtMs)
    )
      return state;
    if (frame.data.version === previous.data.version) {
      if (JSON.stringify(frame.data) !== JSON.stringify(previous.data))
        return disconnectOverlay(state);
      if (serverMs === Date.parse(previous.serverTime)) return state;
    }
  }
  return {
    ...state,
    frame,
    receivedAtMs,
    needsRefetch: false,
    versionFloor: frame.data.version,
    serverTimeFloorMs: serverMs,
  };
}

export function applyEvent(
  state: OverlayState,
  input: unknown,
  receivedAtMs: number,
): OverlayState {
  if (state.protocol === 1) {
    const next = applyOverlayConsumerEvent(state, input, receivedAtMs);
    return next === state ? state : { ...next, protocol: 1 };
  }
  const parsed = OverlayEventV2Schema.safeParse(input);
  if (!parsed.success) return disconnectOverlay(state);
  const event = parsed.data;
  if (event.resourceId !== state.displayId || event.resourceVersion < state.versionFloor)
    return state;
  const gap = () =>
    disconnectOverlay({
      ...state,
      versionFloor: Math.max(state.versionFloor, event.resourceVersion),
      serverTimeFloorMs: Math.max(state.serverTimeFloorMs ?? 0, Date.parse(event.occurredAt)),
    });
  if (event.type === 'resync_required') return gap();
  if (event.type === 'overlay.changed') {
    if (event.resourceVersion === state.frame?.data.version)
      return JSON.stringify(event.data) === JSON.stringify(state.frame.data)
        ? state
        : disconnectOverlay(state);
    if (!state.frame || event.resourceVersion !== state.frame.data.version + 1) return gap();
  }
  return applySnapshot(
    state,
    { schemaVersion: 2, serverTime: event.occurredAt, data: event.data },
    receivedAtMs,
  );
}

export function overlayView(state: OverlayState, nowMs: number, connected: boolean) {
  if (state.protocol === 1) return overlayConsumerView(state, nowMs, connected);
  if (!connected || state.needsRefetch || !state.frame || state.receivedAtMs === null)
    return { snapshot: null, presentation: null };
  const { frame, receivedAtMs } = state;
  const elapsed = nowMs - receivedAtMs;
  const fresh = Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 15_000;
  const collectionSeconds = overlayRemainingSeconds(
    frame.data.collectionClosesAt,
    frame.serverTime,
    receivedAtMs,
    nowMs,
  );
  const fundingSeconds = overlayRemainingSeconds(
    frame.data.challenge?.fundingWindow?.effectiveClosesAt ??
      frame.data.challenge?.terms.fundingClosesAt ??
      null,
    frame.serverTime,
    receivedAtMs,
    nowMs,
  );
  const presentation = {
    fresh,
    collectionSeconds,
    fundingSeconds,
    qrPayload:
      fresh &&
      fundingSeconds !== null &&
      fundingSeconds > 0 &&
      frame.data.presentationState === 'accepted' &&
      frame.data.preferences.template.available
        ? frame.data.qrPayload
        : null,
  };
  return { snapshot: fresh ? frame.data : null, presentation };
}
