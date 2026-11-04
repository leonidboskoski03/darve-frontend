import {
  TemplateSelectionInputSchema,
  TemplateSelectionSchema,
  coinEnvelope,
} from '@/services/contracts/index';
import { createCoinReadClient } from '@/services/coins/index';
import { failure, type ApiFailure } from '@/services/api/index';
import type { CreatorSession } from '@/services/creator-session/index';
import type { AuthorityScope } from '@/services/server-state/index';
import { TemplateError, type TemplateResources } from './client';
type Selection = Awaited<ReturnType<ReturnType<typeof createCoinReadClient>['selection']>>;
type Attempt = Readonly<{
  name: string;
  input: Readonly<ReturnType<typeof TemplateSelectionInputSchema.parse>>;
}>;
export type TemplateSelectionState = Readonly<{
  phase: 'idle' | 'review' | 'sending' | 'unconfirmed' | 'checked' | 'confirmed';
  attempt: Attempt | null;
  error: ApiFailure | null;
}>;
const idle: TemplateSelectionState = { phase: 'idle', attempt: null, error: null },
  schema = coinEnvelope(TemplateSelectionSchema);
function build(session: CreatorSession, supports: (id: string, version: number) => boolean) {
  const scope = session.getSnapshot().scope,
    readers = createCoinReadClient(session),
    listeners = new Set<() => void>();
  let state: TemplateSelectionState = idle;
  function active() {
    if (
      scope.signal.aborted ||
      session.getSnapshot().scope !== scope ||
      session.getSnapshot().phase !== 'authenticated'
    )
      throw new TemplateError(failure('authority', 'AUTHORITY_CHANGED'));
  }
  function invalid(): never {
    throw new TemplateError(failure('configuration', 'INVALID_TEMPLATE_SELECTION'));
  }
  const publish = (next: TemplateSelectionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  scope.onDispose(() => {
    state = idle;
    clients.delete(scope);
    for (const listener of listeners) listener();
    listeners.clear();
  });
  return {
    scope,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    async read(signal: AbortSignal): Promise<Selection> {
      active();
      const value = await readers.selection(signal);
      active();
      if (state.phase === 'unconfirmed' && state.attempt) {
        const input = state.attempt.input;
        publish({
          phase:
            value.data.templateId === input.templateId &&
            value.data.revision > input.expectedRevision
              ? 'confirmed'
              : 'checked',
          attempt: null,
          error: state.error,
        });
      }
      return value;
    },
    prepare(resources: TemplateResources, selection: Selection, id: string) {
      active();
      if (state.attempt) invalid();
      const item = resources.catalogue.data.templates.find((row) => row.id === id),
        owned = resources.entitlements.data.templates.find((row) => row.id === id);
      if (
        !item?.available ||
        !owned?.owned ||
        owned.ownershipState !== 'owned' ||
        !supports(id, item.assetVersion) ||
        selection.data.templateId === id
      )
        invalid();
      const input = Object.freeze(
        TemplateSelectionInputSchema.parse({
          expectedRevision: selection.data.revision,
          templateId: id,
        }),
      );
      publish({
        phase: 'review',
        attempt: Object.freeze({ name: item.displayName, input }),
        error: null,
      });
    },
    cancel() {
      active();
      if (state.phase === 'review') publish(idle);
    },
    async select(confirmed: boolean) {
      active();
      if (!confirmed || state.phase !== 'review' || !state.attempt) invalid();
      const attempt = state.attempt;
      void scope.queryClient.cancelQueries({ queryKey: scope.key(['templates', 'selection']) });
      publish({ ...state, phase: 'sending', error: null });
      const result = await session
        .request({
          path: '/api/template-preferences',
          method: 'POST',
          body: attempt.input,
          schema,
          success: [200],
        })
        .catch(() => failure('network', 'SELECTION_RESULT_UNKNOWN'));
      if (scope.signal.aborted) return;
      active();
      const error =
        result.kind === 'data' &&
        result.data.data.templateId === attempt.input.templateId &&
        result.data.data.revision > attempt.input.expectedRevision
          ? null
          : result.kind === 'error'
            ? result
            : failure('protocol', 'SELECTION_RESPONSE_MISMATCH');
      publish({ ...state, phase: 'unconfirmed', error });
      void scope.queryClient.invalidateQueries({ queryKey: scope.key(['overlay-preferences']) });
    },
  };
}
export type TemplateSelectionClient = ReturnType<typeof build>;
const clients = new WeakMap<AuthorityScope, TemplateSelectionClient>();
export function createTemplateSelectionClient(
  session: CreatorSession,
  supports: (id: string, version: number) => boolean,
) {
  const scope = session.getSnapshot().scope;
  let client = clients.get(scope);
  if (!client) {
    client = build(session, supports);
    clients.set(scope, client);
  }
  return client;
}
