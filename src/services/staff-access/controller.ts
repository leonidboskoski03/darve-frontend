import { createJsonClient, failure, type ApiFailure, type JsonRequest } from '@/services/api/index';
import {
  StaffSessionResponseSchema,
  StaffEmailCodeStatusResponseSchema,
  StaffLoginInputSchema,
  StaffAuthorizationStartResponseSchema,
  StaffEmailCodeInputSchema,
  StaffEmailCodeVerifiedResponseSchema,
  StaffEmailCodeResentResponseSchema,
  StaffEmailCodeCancelledResponseSchema,
  StaffEnrollmentAcceptedResponseSchema,
  StaffLogoutResponseSchema,
} from '@/services/contracts/index';
import { createAuthorityScope, type AuthorityScope } from '@/services/server-state/index';
import { parseStaffEnvironment } from '@/services/config/index';
import { isStaffAuthorizationUrl, staffReturnPath } from './location';
import { readLogoutIntent, writeLogoutIntent } from './logout-intent';

type Session = ReturnType<typeof StaffSessionResponseSchema.parse>['data'];
type Authenticated = Extract<Session, { state: 'authenticated' }>;
type Phase =
  | 'unconfigured'
  | 'checking'
  | 'signed_out'
  | 'email_code_pending'
  | 'enrollment_pending'
  | 'authenticated'
  | 'expired'
  | 'unavailable'
  | 'redirecting'
  | 'logout_unconfirmed';
type Command = 'sign_in' | 'step_up' | 'verify' | 'resend' | 'cancel' | 'accept' | 'logout';
export type StaffSnapshot = {
  phase: Phase;
  busy: Command | null;
  staff: Authenticated['staff'] | null;
  role: 'OWNER_ADMIN' | 'SUPPORT' | null;
  permissions: readonly string[];
  expiresAt: string | null;
  authenticatedAt: string | null;
  error: ApiFailure | null;
  notice: string | null;
  invitationAvailable: boolean;
  invitationInvalid: boolean;
  retryAt: number;
  scope: AuthorityScope;
};

/** Staff-only, in-memory proof lifecycle. Callback hints and creator state never establish authority. */
export function createStaffAccess({
  invitation: initialInvitation,
  ...options
}: {
  origin?: string | undefined;
  authorizationEndpoint?: string | undefined;
  frontendOrigin: string;
  appEnv?: 'local' | 'staging' | 'production';
  invitation?: string | null;
  invitationInvalid?: boolean;
  returnPath?: string;
  fetcher?: typeof fetch | undefined;
  now?: () => number;
  navigate?: (url: string) => void;
  navigateReturn?: (path: string) => void;
}) {
  let configured = false;
  try {
    parseStaffEnvironment({
      STAFF_PUBLIC_APP_ENV: options.appEnv ?? 'local',
      ...(options.origin === undefined ? {} : { STAFF_PUBLIC_API_ORIGIN: options.origin }),
      ...(options.authorizationEndpoint === undefined
        ? {}
        : { STAFF_PUBLIC_AUTHORIZATION_ENDPOINT: options.authorizationEndpoint }),
    });
    configured = Boolean(
      options.origin &&
      options.authorizationEndpoint &&
      new URL(options.origin).hostname === new URL(options.frontendOrigin).hostname,
    );
  } catch {
    /* An invalid entry is never allowed to fetch staff data. */
  }
  const now = options.now ?? Date.now;
  let invitation = initialInvitation ?? null;
  let proof: string | null = null;
  let logoutProof: string | null = null;
  let logoutHold = readLogoutIntent();
  const holdLogout = (held: boolean) => {
    logoutHold = held;
    writeLogoutIntent(held);
  };
  let running = false;
  let active: Command | null = null;
  let inspection: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | null = null;
  let operation = 0;
  let retryUntil = 0;
  let snapshot: StaffSnapshot = {
    phase: configured ? 'checking' : 'unconfigured',
    busy: null,
    staff: null,
    role: null,
    permissions: [],
    expiresAt: null,
    authenticatedAt: null,
    error: null,
    notice: null,
    invitationAvailable: Boolean(invitation),
    invitationInvalid: options.invitationInvalid ?? false,
    retryAt: 0,
    scope: createAuthorityScope('staff'),
  };
  const listeners = new Set<() => void>();
  const emit = (next: StaffSnapshot) => {
    snapshot = { ...next, retryAt: retryUntil };
    listeners.forEach((listener) => listener());
  };
  const remember = (error: ApiFailure | null) => {
    if (error && [429, 503].includes(error.status ?? 0) && error.retryAfterSeconds !== null)
      retryUntil = now() + Math.min(3600, Math.max(1, error.retryAfterSeconds)) * 1000;
  };
  function clear(phase: Phase, error: ApiFailure | null = null) {
    if (timer) clearTimeout(timer);
    snapshot.scope.dispose();
    proof = null;
    emit({
      ...snapshot,
      phase,
      busy: active,
      staff: null,
      role: null,
      permissions: [],
      expiresAt: null,
      authenticatedAt: null,
      notice: null,
      error,
      scope: createAuthorityScope('staff'),
    });
  }
  const client = (scope: AuthorityScope, csrf: string | null = null) =>
    createJsonClient({
      origin: options.origin!,
      audience: 'staff',
      csrf: () => csrf,
      lifetime: scope.signal,
      fetcher: options.fetcher,
    });
  function expire(scope: AuthorityScope, serverTime: string, expiresAt: string) {
    const deadline = now() + Date.parse(expiresAt) - Date.parse(serverTime);
    const tick = () => {
      if (!running || scope.signal.aborted) return;
      const remaining = deadline - now();
      if (remaining <= 0) clear('expired', failure('authority', 'STAFF_ACCESS_EXPIRED'));
      else timer = setTimeout(tick, Math.min(remaining, 2147483647));
    };
    tick();
  }
  async function inspect(error: ApiFailure | null = null, force = false) {
    if (!running || !configured || (!force && (active || now() < retryUntil))) return;
    if (inspection) return inspection;
    remember(error);
    clear('checking');
    const scope = snapshot.scope;
    const task = (async () => {
      const [session, pending] = await Promise.all([
        client(scope)({
          path: '/admin/v1/session',
          schema: StaffSessionResponseSchema,
          success: [200],
        }),
        client(scope)({
          path: '/admin/v1/auth/email-code',
          schema: StaffEmailCodeStatusResponseSchema,
          success: [200],
        }),
      ]);
      if (!running || scope.signal.aborted) return;
      const absent = (value: typeof pending | typeof session) =>
        value.kind === 'error' && value.status === 401 && value.category === 'http';
      if (
        (session.kind !== 'data' && !absent(session)) ||
        (pending.kind !== 'data' && !absent(pending))
      ) {
        const problem =
          session.kind === 'error' && !absent(session)
            ? session
            : pending.kind === 'error'
              ? pending
              : failure('protocol', 'INVALID_STAFF_STATE');
        remember(problem);
        clear(logoutHold ? 'logout_unconfirmed' : 'unavailable', problem);
        return;
      }
      const state: Session = session.kind === 'data' ? session.data.data : { state: 'signed_out' };
      if (logoutHold) {
        if (state.state === 'authenticated') {
          logoutProof = state.csrfToken;
          clear('logout_unconfirmed', error);
          return;
        }
        holdLogout(false);
        logoutProof = null;
      }
      if (pending.kind === 'data') {
        proof = pending.data.data.csrfToken;
        emit({
          ...snapshot,
          phase: 'email_code_pending',
          expiresAt: pending.data.data.expiresAt,
          error,
        });
        expire(scope, pending.data.serverTime, pending.data.data.expiresAt);
        return;
      }
      if (state.state === 'signed_out') {
        emit({ ...snapshot, phase: 'signed_out', error });
        return;
      }
      proof = state.csrfToken;
      emit({
        ...snapshot,
        phase: state.state,
        role: state.state === 'authenticated' ? state.staff.role : state.role,
        staff: state.state === 'authenticated' ? state.staff : null,
        permissions: state.state === 'authenticated' ? state.permissions : [],
        authenticatedAt: state.state === 'authenticated' ? state.authenticatedAt : null,
        expiresAt: state.expiresAt,
        error,
      });
      if (session.kind === 'data') expire(scope, session.data.serverTime, state.expiresAt);
    })();
    inspection = task;
    try {
      await task;
    } finally {
      if (inspection === task) inspection = null;
    }
  }
  const invalidate = () => {
    operation++;
    active = null;
    inspection = null;
    clear(
      logoutHold ? 'logout_unconfirmed' : now() < retryUntil ? 'unavailable' : 'checking',
      snapshot.error,
    );
    if (document.visibilityState !== 'hidden') void inspect();
  };
  const focus = () => {
    if (document.visibilityState !== 'hidden') void inspect();
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') invalidate();
    else focus();
  };

  async function authorize(stepUp: boolean) {
    if (
      !running ||
      !configured ||
      active ||
      now() < retryUntil ||
      !(stepUp
        ? snapshot.phase === 'authenticated'
        : ['signed_out', 'expired'].includes(snapshot.phase))
    )
      return;
    const serial = ++operation;
    active = stepUp ? 'step_up' : 'sign_in';
    emit({ ...snapshot, busy: active, error: null, notice: null });
    const scope = snapshot.scope;
    try {
      const body = StaffLoginInputSchema.parse({
        ...(invitation && !stepUp ? { invitationSecret: invitation } : {}),
        returnPath: staffReturnPath(options.returnPath ?? '/'),
      });
      const result = await client(
        scope,
        stepUp ? proof : null,
      )({
        path: stepUp ? '/admin/v1/auth/step-up' : '/admin/v1/auth/start',
        method: 'POST',
        body,
        schema: StaffAuthorizationStartResponseSchema,
        success: [200],
      });
      if (scope.signal.aborted || !running) return;
      if (result.kind !== 'data') {
        remember(result.kind === 'error' ? result : null);
        if (result.kind === 'error' && [429, 503].includes(result.status ?? 0)) {
          clear('unavailable', result);
          return;
        }
        if (stepUp && result.kind === 'error' && [401, 403].includes(result.status ?? 0)) {
          await inspect(result, true);
          return;
        }
        emit({
          ...snapshot,
          error:
            result.kind === 'error' ? result : failure('protocol', 'INVALID_STAFF_AUTHORIZATION'),
        });
        return;
      }
      if (
        !isStaffAuthorizationUrl(
          result.data.data.authorizationUrl,
          options.authorizationEndpoint!,
          options.origin!,
        )
      ) {
        emit({ ...snapshot, error: failure('protocol', 'INVALID_STAFF_AUTHORIZATION') });
        return;
      }
      invitation = null;
      clear('redirecting');
      emit({ ...snapshot, invitationAvailable: false });
      channel?.postMessage('invalidate');
      (options.navigate ?? ((url) => window.location.assign(url)))(
        result.data.data.authorizationUrl,
      );
    } catch {
      if (running) clear('unavailable', failure('protocol', 'STAFF_NAVIGATION_UNCONFIRMED'));
    } finally {
      if (serial === operation) active = null;
      if (running && serial === operation) {
        emit({ ...snapshot, busy: null });
        if (snapshot.phase === 'checking') void inspect();
      }
    }
  }
  async function command<T>(
    name: Command,
    phases: Phase[],
    request: JsonRequest<T>,
    completed?: (value: T) => { path: string; phase: 'authenticated' | 'enrollment_pending' },
  ) {
    if (!running || !configured || active || now() < retryUntil || !phases.includes(snapshot.phase))
      return;
    const serial = ++operation;
    const csrf = name === 'logout' && logoutHold ? logoutProof : proof;
    active = name;
    if (name === 'logout') {
      holdLogout(true);
      logoutProof = csrf;
      clear('checking');
    }
    emit({ ...snapshot, busy: name, error: null, notice: null });
    const scope = snapshot.scope;
    try {
      const result = await client(scope, csrf)(request);
      if (!running || scope.signal.aborted) return;
      let transition: ReturnType<NonNullable<typeof completed>> | null = null;
      let error = result.kind === 'error' ? result : null;
      if (
        name === 'logout' &&
        (result.kind === 'data' || (result.kind === 'error' && result.status === 401))
      ) {
        holdLogout(false);
        logoutProof = null;
        error = null;
      }
      if (result.kind === 'data') {
        transition = completed?.(result.data) ?? null;
        channel?.postMessage('invalidate');
      }
      if (error && [429, 503].includes(error.status ?? 0)) {
        remember(error);
        clear(logoutHold ? 'logout_unconfirmed' : 'unavailable', error);
        return;
      }
      await inspect(error, true);
      if (!running || serial !== operation) return;
      if (result.kind === 'data' && transition !== null) {
        if (snapshot.phase !== transition.phase) {
          clear('unavailable', failure('authority', 'STAFF_TRANSITION_UNCONFIRMED'));
          return;
        }
        options.navigateReturn?.(staffReturnPath(transition.path));
      }
      if (result.kind === 'data' && name === 'resend' && snapshot.phase === 'email_code_pending')
        emit({ ...snapshot, notice: 'A new code has been sent. Use the latest email.' });
    } finally {
      if (serial === operation) active = null;
      if (running && serial === operation) {
        emit({ ...snapshot, busy: null });
        if (snapshot.phase === 'checking') void inspect();
      }
    }
  }
  return {
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
      if (snapshot.scope.signal.aborted)
        clear(!configured ? 'unconfigured' : now() < retryUntil ? 'unavailable' : 'checking');
      if (configured && typeof window !== 'undefined') {
        window.addEventListener('focus', focus);
        document.addEventListener('visibilitychange', visibility);
        if (typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel('darve-staff-authority');
          channel.onmessage = (event: MessageEvent<unknown>) => {
            if (event.data === 'invalidate') invalidate();
          };
        }
      }
      void inspect();
    },
    stop() {
      running = false;
      operation++;
      inspection = null;
      active = null;
      proof = null;
      logoutProof = null;
      invitation = null;
      if (timer) clearTimeout(timer);
      clear(configured ? 'checking' : 'unconfigured');
      emit({ ...snapshot, invitationAvailable: false });
      snapshot.scope.dispose();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', focus);
        document.removeEventListener('visibilitychange', visibility);
      }
      channel?.close();
      channel = null;
    },
    inspect: () => inspect(),
    signIn: () => authorize(false),
    stepUp: () => authorize(true),
    verify(code: string) {
      const input = StaffEmailCodeInputSchema.safeParse({ code });
      if (!input.success) {
        emit({ ...snapshot, error: failure('configuration', 'INVALID_STAFF_CODE') });
        return Promise.resolve();
      }
      return command(
        'verify',
        ['email_code_pending'],
        {
          path: '/admin/v1/auth/email-code/verify',
          method: 'POST',
          body: input.data,
          schema: StaffEmailCodeVerifiedResponseSchema,
          success: [200],
        },
        (value) => ({ path: value.data.returnPath, phase: value.data.state }),
      );
    },
    resend: () =>
      command('resend', ['email_code_pending'], {
        path: '/admin/v1/auth/email-code/resend',
        method: 'POST',
        body: {},
        schema: StaffEmailCodeResentResponseSchema,
        success: [200],
      }),
    cancel: () =>
      command('cancel', ['email_code_pending'], {
        path: '/admin/v1/auth/email-code/cancel',
        method: 'POST',
        body: {},
        schema: StaffEmailCodeCancelledResponseSchema,
        success: [200],
      }),
    accept(confirmed: boolean) {
      return confirmed
        ? command(
            'accept',
            ['enrollment_pending'],
            {
              path: '/admin/v1/invitations/accept',
              method: 'POST',
              body: {},
              schema: StaffEnrollmentAcceptedResponseSchema,
              success: [200],
            },
            () => ({ path: '/', phase: 'authenticated' }),
          )
        : Promise.resolve();
    },
    logout: () =>
      command('logout', ['authenticated', 'logout_unconfirmed'], {
        path: '/admin/v1/session/logout',
        method: 'POST',
        body: {},
        schema: StaffLogoutResponseSchema,
        success: [200],
      }),
  };
}
export type StaffAccess = ReturnType<typeof createStaffAccess>;
