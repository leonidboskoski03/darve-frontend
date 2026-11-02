import {
  OverlayParamsSchema,
  OverlayIssueInputSchema,
  OverlayGrantIssuedResponseSchema,
  OverlaySelectionInputSchema,
  OverlaySelectionResponseSchema,
  OverlayPreferencesV2InputSchema,
  OverlayPreferencesV2ResponseSchema,
} from '@/services/contracts/index';
import { failure, type JsonRequest, type ApiFailure } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';
export type Selection = ReturnType<typeof OverlaySelectionResponseSchema.parse>['data'];
export type Preferences = ReturnType<typeof OverlayPreferencesV2ResponseSchema.parse>['data'];
class OverlayError extends Error {
  constructor(readonly problem: ApiFailure) {
    super('Overlay request could not be confirmed.');
  }
}
export function overlayMessage(error: unknown) {
  if (!(error instanceof OverlayError))
    return 'Overlay information could not be confirmed. Refresh before continuing.';
  if (error.problem.status === 409)
    return 'The display changed. Refresh and review its current selection or settings.';
  if (error.problem.status === 401)
    return 'Your session changed. Check your account before continuing.';
  if (error.problem.status === 404) return 'This display or grant is unavailable for your account.';
  return 'The result is unconfirmed. Refresh the current display before another change. A link may have been issued; do not automatically create a replacement.';
}
export function createOverlayOwner(session: CreatorSession) {
  const scope = session.getSnapshot().scope;
  let busy = false;
  const active = () => {
    if (
      scope.signal.aborted ||
      session.getSnapshot().scope !== scope ||
      session.getSnapshot().phase !== 'authenticated'
    )
      throw new OverlayError(failure('authority', 'AUTHORITY_CHANGED'));
  };
  const request = async <T>(input: JsonRequest<T>) => {
    active();
    const mutation = input.method && input.method !== 'GET';
    if (mutation && busy) throw new OverlayError(failure('authority', 'COMMAND_PENDING'));
    if (mutation) busy = true;
    try {
      const result = await session.request(input);
      active();
      if (result.kind === 'data') return result.data;
      if (result.kind === 'empty' && input.success.includes(204)) return null;
      throw new OverlayError(
        result.kind === 'error' ? result : failure('protocol', 'INVALID_OVERLAY_RESPONSE'),
      );
    } finally {
      if (mutation) busy = false;
    }
  };
  const id = (value: string) => OverlayParamsSchema.parse({ id: value }).id.toLowerCase();
  return {
    async issue(input: unknown = {}) {
      const result = (await request({
        path: '/api/overlay-grants',
        method: 'POST',
        body: OverlayIssueInputSchema.parse(input),
        schema: OverlayGrantIssuedResponseSchema,
        success: [201],
      }))!;
      const data = result.data,
        url = new URL(data.presentationUrl);
      if (
        data.displayId !== data.selection.displayId ||
        url.pathname !== '/overlay/' + data.displayId ||
        !/^#grant=[A-Za-z0-9_-]{43}$/.test(url.hash) ||
        url.search ||
        url.username ||
        url.password ||
        (url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
      )
        throw new OverlayError(failure('protocol', 'INVALID_PRESENTATION_URL'));
      return data;
    },
    revoke: (grantId: string) =>
      request({
        path: '/api/overlay-grants/' + id(grantId),
        method: 'DELETE',
        schema: OverlaySelectionResponseSchema,
        success: [204],
      }),
    async selection(displayId: string, signal?: AbortSignal) {
      const result = (await request({
        path: '/api/overlay-displays/' + id(displayId),
        schema: OverlaySelectionResponseSchema,
        success: [200],
        signal,
      }))!;
      if (result.data.displayId !== id(displayId))
        throw new OverlayError(failure('protocol', 'RESOURCE_MISMATCH'));
      return result.data;
    },
    async select(displayId: string, input: unknown) {
      const body = OverlaySelectionInputSchema.parse(input);
      const result = (await request({
        path: '/api/overlay-displays/' + id(displayId) + '/selection',
        method: 'PUT',
        body,
        schema: OverlaySelectionResponseSchema,
        success: [200],
      }))!;
      if (
        result.data.displayId !== id(displayId) ||
        result.data.roundId !== body.roundId ||
        result.data.challengeId !== body.challengeId ||
        result.data.version <= body.expectedVersion
      )
        throw new OverlayError(failure('protocol', 'RESOURCE_MISMATCH'));
      return result.data;
    },
    async preferences(signal?: AbortSignal) {
      return (await request({
        path: '/api/overlay-preferences?protocolVersion=2',
        schema: OverlayPreferencesV2ResponseSchema,
        success: [200],
        signal,
      }))!.data;
    },
    async save(input: unknown) {
      const body = OverlayPreferencesV2InputSchema.parse(input);
      const result = (await request({
        path: '/api/overlay-preferences?protocolVersion=2',
        method: 'PATCH',
        body,
        schema: OverlayPreferencesV2ResponseSchema,
        success: [200],
      }))!.data;
      if (
        result.version <= body.expectedVersion ||
        JSON.stringify(result.styles) !== JSON.stringify(body.styles)
      )
        throw new OverlayError(failure('protocol', 'PREFERENCES_MISMATCH'));
      return result;
    },
  };
}
export type OverlayOwner = ReturnType<typeof createOverlayOwner>;
