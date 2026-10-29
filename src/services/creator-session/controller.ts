import {
  createJsonClient,
  failure,
  type ApiFailure,
  type ApiResult,
  type JsonRequest,
} from '@/services/api/index';
import { SessionResponseSchema, type SessionProfile } from '@/services/contracts/index';
import { createAuthorityScope, type AuthorityScope } from '@/services/server-state/index';

type Phase =
  | 'unconfigured'
  | 'loading'
  | 'signed_out'
  | 'authenticated'
  | 'expired'
  | 'unavailable'
  | 'signing_out'
  | 'logout_unconfirmed';
export type CreatorSnapshot = {
  phase: Phase;
  user: SessionProfile | null;
  expiresAt: string | null;
  error: ApiFailure | null;
  scope: AuthorityScope;
};

/** In-memory creator authority. Tokens never enter Query data, URLs or browser storage. */
export function createCreatorSession(options: {
  origin?: string | undefined;
  fetcher?: typeof fetch | undefined;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let proof: string | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let logoutUncertain = false;
  let inspection: Promise<void> | null = null;
  let channel: BroadcastChannel | null = null;
  let snapshot: CreatorSnapshot = {
    phase: options.origin ? 'loading' : 'unconfigured',
    user: null,
    expiresAt: null,
    error: null,
    scope: createAuthorityScope('creator'),
  };
  const listeners = new Set<() => void>();
  const publish = (next: CreatorSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const rotate = (phase: Phase, error: ApiFailure | null = null) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    snapshot.scope.dispose();
    proof = null;
    publish({ phase, user: null, expiresAt: null, error, scope: createAuthorityScope('creator') });
  };
  const client = (scope: AuthorityScope, csrf: () => string | null = () => proof) =>
    createJsonClient({
      origin: options.origin!,
      audience: 'creator',
      lifetime: scope.signal,
      csrf,
      fetcher: options.fetcher,
    });
  const expired = () => snapshot.expiresAt !== null && Date.parse(snapshot.expiresAt) <= now();
  const expire = () => rotate('expired');

  async function inspect() {
    if (!options.origin || !running || logoutUncertain || snapshot.phase === 'signing_out') return;
    if (inspection) return inspection;
    rotate('loading');
    const scope = snapshot.scope;
    const task = (async () => {
      const result = await client(scope)({
        path: '/api/session',
        schema: SessionResponseSchema,
        success: [200],
      });
      if (scope.signal.aborted || !running) return;
      if (result.kind !== 'data') {
        rotate(
          'unavailable',
          result.kind === 'error' ? result : failure('protocol', 'INVALID_SESSION_RESPONSE'),
        );
        return;
      }
      if (!result.data.authenticated) {
        publish({ ...snapshot, phase: 'signed_out' });
        return;
      }
      const remaining = Date.parse(result.data.expiresAt) - now();
      if (remaining <= 0) {
        expire();
        return;
      }
      proof = result.data.csrfToken;
      publish({
        ...snapshot,
        phase: 'authenticated',
        user: result.data.user,
        expiresAt: result.data.expiresAt,
      });
      const expiresAt = result.data.expiresAt;
      const schedule = () => {
        if (scope.signal.aborted || !running) return;
        const delay = Date.parse(expiresAt) - now();
        if (delay <= 0) expire();
        else expiryTimer = setTimeout(schedule, Math.min(delay, 2_147_483_647));
      };
      schedule();
    })();
    inspection = task;
    try {
      await task;
    } finally {
      if (inspection === task) inspection = null;
    }
  }

  const recheck = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void inspect();
  };

  return {
    origin: options.origin,
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (running) return;
      running = true;
      // A stopped StrictMode generation must never be reused.
      if (snapshot.scope.signal.aborted) rotate(options.origin ? 'loading' : 'unconfigured');
      if (options.origin && typeof window !== 'undefined') {
        window.addEventListener('focus', recheck);
        document.addEventListener('visibilitychange', recheck);
        if (typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel('darve-creator-authority');
          channel.onmessage = (event: MessageEvent<unknown>) => {
            if (event.data !== 'invalidate') return;
            // A peer's confirmed authority change supersedes an in-flight inspection.
            inspection = null;
            void inspect();
          };
        }
      }
      void inspect();
    },
    stop() {
      running = false;
      inspection = null;
      if (expiryTimer) clearTimeout(expiryTimer);
      proof = null;
      snapshot.scope.dispose();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', recheck);
        document.removeEventListener('visibilitychange', recheck);
      }
      channel?.close();
      channel = null;
    },
    inspect,
    async request<T>(request: JsonRequest<T>): Promise<ApiResult<T>> {
      if (expired()) expire();
      if (!options.origin || snapshot.phase !== 'authenticated')
        return failure('authority', 'CREATOR_SESSION_REQUIRED');
      const scope = snapshot.scope;
      const result = await client(scope)(request);
      if (scope.signal.aborted) return failure('cancelled', 'AUTHORITY_CHANGED');
      if (result.kind === 'error' && result.status === 401) rotate('expired', result);
      return result;
    },
    async logout() {
      if (!options.origin || snapshot.phase === 'signing_out') return;
      const csrf = proof;
      rotate('signing_out');
      const scope = snapshot.scope;
      const result = await client(
        scope,
        () => csrf,
      )({
        path: '/api/session/logout',
        method: 'POST',
        schema: SessionResponseSchema,
        success: [204],
      });
      if (scope.signal.aborted || !running) return;
      if (result.kind === 'empty' || (result.kind === 'error' && result.status === 401)) {
        logoutUncertain = false;
        rotate('signed_out');
        channel?.postMessage('invalidate');
      } else {
        logoutUncertain = true;
        rotate(
          'logout_unconfirmed',
          result.kind === 'error' ? result : failure('protocol', 'INVALID_LOGOUT_RESPONSE'),
        );
        // Permit only an explicit repeat of the same revoke intent. No automatic replay/re-entry.
        proof = csrf;
      }
    },
  };
}
export type CreatorSession = ReturnType<typeof createCreatorSession>;
