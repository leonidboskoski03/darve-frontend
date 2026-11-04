import {
  OverlayParamsSchema,
  OverlayBootstrapInputSchema,
  OverlayBootstrapResponseSchema,
} from '@/services/contracts/index';
import { createJsonClient } from '@/services/api/index';
import { createAuthorityScope } from '@/services/server-state/index';
import { createOverlaySubscription, type OverlayStreamSnapshot } from '@/services/realtime/index';

type Entry = { displayId: string; secret: string | null; grantId: string | null };
const empty = (phase: OverlayStreamSnapshot['phase']): OverlayStreamSnapshot => ({
  phase,
  snapshot: null,
  presentation: null,
  error: null,
});

/** Consume the access fragment before mounting. No secret is retained in history or query data. */
export function readOverlayLocation(href: string): Entry | null {
  const url = new URL(href),
    match = /^\/overlay\/([^/]+)$/.exec(url.pathname);
  if (!match || !OverlayParamsSchema.safeParse({ id: match[1] }).success || url.search) return null;
  const hash = new URLSearchParams(url.hash.slice(1));
  if ([...hash.keys()].length !== 1) return null;
  const secret = hash.get('grant'),
    grantId = hash.get('grantId');
  if (secret && OverlayBootstrapInputSchema.safeParse({ secret }).success)
    return { displayId: match[1]!.toLowerCase(), secret, grantId: null };
  if (grantId && OverlayParamsSchema.safeParse({ id: grantId }).success)
    return { displayId: match[1]!.toLowerCase(), secret: null, grantId: grantId.toLowerCase() };
  return null;
}

export function createOverlayReader(options: {
  origin?: string | undefined;
  entry: Entry | null;
  replace: (fragment: string) => void;
  fetcher?: typeof fetch;
}) {
  let entry = options.entry,
    value = empty('idle'),
    generation = 0,
    disposed = false;
  let cleanup = () => {},
    currentScope: ReturnType<typeof createAuthorityScope> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: OverlayStreamSnapshot) => {
    value = next;
    listeners.forEach((fn) => fn());
  };
  const halt = () => {
    generation++;
    cleanup();
    cleanup = () => {};
    currentScope?.dispose();
    currentScope = null;
    publish(empty('stopped'));
  };
  const start = async () => {
    halt();
    if (disposed) return;
    if (!options.origin || !entry) {
      if (entry) entry.secret = null;
      publish(empty('unavailable'));
      return;
    }
    const id = generation,
      scope = createAuthorityScope('overlay');
    currentScope = scope;
    publish(empty('connecting'));
    let grantId = entry.grantId;
    if (entry.secret) {
      const secret = entry.secret;
      const result = await createJsonClient({
        origin: options.origin,
        audience: 'overlay',
        lifetime: scope.signal,
        fetcher: options.fetcher,
      })({
        path: '/api/overlays/' + entry.displayId + '/session?protocolVersion=2',
        method: 'POST',
        body: { secret },
        schema: OverlayBootstrapResponseSchema,
        success: [200],
      });
      if (disposed || generation !== id) return;
      entry.secret = null;
      if (result.kind !== 'data' || result.data.data.displayId !== entry.displayId) {
        scope.dispose();
        publish(empty('denied'));
        return;
      }
      grantId = result.data.data.grantId;
      entry = { ...entry, grantId };
      options.replace('#grantId=' + grantId);
    }
    if (!grantId) {
      scope.dispose();
      publish(empty('denied'));
      return;
    }
    const stream = createOverlaySubscription({
      origin: options.origin,
      displayId: entry.displayId,
      grantId,
      protocol: 2,
      scope,
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    });
    const unsubscribe = stream.subscribe(() => {
      if (!disposed && generation === id) publish(stream.getSnapshot());
    });
    cleanup = () => {
      unsubscribe();
      stream.stop();
    };
    stream.start();
  };
  let obsVisible = true,
    obsActive = true,
    suspended = false;
  const visibility = () => {
    const hidden = document.visibilityState === 'hidden' || !obsVisible || !obsActive;
    if (hidden === suspended) return;
    suspended = hidden;
    if (hidden) halt();
    else void start();
  };
  const obsState = (event: Event) => {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== 'object') return;
    if (
      event.type === 'obsSourceVisibleChanged' &&
      'visible' in detail &&
      typeof detail.visible === 'boolean'
    )
      obsVisible = detail.visible;
    else if (
      event.type === 'obsSourceActiveChanged' &&
      'active' in detail &&
      typeof detail.active === 'boolean'
    )
      obsActive = detail.active;
    else return;
    visibility();
  };
  const pagehide = () => {
    suspended = true;
    halt();
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (event.persisted) visibility();
  };
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    start() {
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('pagehide', pagehide);
      window.addEventListener('pageshow', pageshow);
      window.addEventListener('obsSourceVisibleChanged', obsState);
      window.addEventListener('obsSourceActiveChanged', obsState);
      suspended = document.visibilityState === 'hidden';
      if (!suspended) void start();
    },
    dispose() {
      disposed = true;
      halt();
      if (entry) entry.secret = null;
      entry = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('obsSourceVisibleChanged', obsState);
      window.removeEventListener('obsSourceActiveChanged', obsState);
      listeners.clear();
    },
  };
}
export type OverlayReader = ReturnType<typeof createOverlayReader>;
