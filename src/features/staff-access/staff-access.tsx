import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { StaffAccess, StaffSnapshot } from '@/services/staff-access/index';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { ActionLink } from '@/design-system/action-link';
import { TextField } from '@/design-system/text-field';
import './staff-access.css';

const roleLabel = (role: StaffSnapshot['role']) =>
  role === 'OWNER_ADMIN' ? 'Owner administrator' : 'Support';
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '';
function problem(snapshot: StaffSnapshot) {
  if (!snapshot.error) return null;
  if (snapshot.error.code === 'INVALID_STAFF_CODE') return 'Enter the complete eight-digit code.';
  if (snapshot.error.status === 429) return 'Too many attempts. Wait before trying again.';
  if (snapshot.error.status === 503)
    return 'Staff access is temporarily unavailable. Check again in a moment.';
  if (snapshot.phase === 'email_code_pending' && snapshot.error.status === 401)
    return 'That code could not be verified. Check the latest email and try again.';
  if (snapshot.error.status === 403)
    return 'This action is not permitted with your current staff access. Check your session before continuing.';
  return 'The result could not be confirmed. Check staff access before trying again.';
}
function StaffScreen({ access, snapshot }: { access: StaffAccess; snapshot: StaffSnapshot }) {
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [snapshot.phase]);
  useEffect(() => {
    if (snapshot.retryAt <= Date.now()) return;
    const tick = setInterval(() => {
      const current = Date.now();
      setClock(current);
      if (current >= snapshot.retryAt) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [snapshot.retryAt]);
  const waiting = snapshot.retryAt > clock;
  const disabled = Boolean(snapshot.busy) || waiting;
  const error = problem(snapshot);
  const phase = snapshot.phase;
  const headings: Record<StaffSnapshot['phase'], string> = {
    unconfigured: 'Staff access is unavailable',
    checking: snapshot.busy === 'logout' ? 'Signing out' : 'Checking staff access',
    signed_out: snapshot.invitationAvailable ? 'You’ve been invited' : 'Sign in to Darve staff',
    email_code_pending: 'Check your email',
    enrollment_pending: 'Review your invitation',
    authenticated: 'You’re signed in',
    expired: 'Your staff access expired',
    unavailable: 'Staff access couldn’t be checked',
    redirecting: 'Opening staff sign-in',
    logout_unconfirmed: 'Sign-out isn’t confirmed',
  };
  return (
    <div className="staff-shell">
      <header className="staff-header">
        <Brand />
        <span className="staff-label">Staff workspace</span>
      </header>
      <main id="staff-main" className="staff-layout">
        <section
          className="staff-content"
          aria-labelledby="staff-title"
          aria-busy={Boolean(snapshot.busy) || phase === 'checking'}
        >
          <p className="staff-context">Staff access</p>
          <h1 id="staff-title" ref={title} tabIndex={-1}>
            {headings[phase]}
          </h1>
          {error && phase !== 'expired' ? (
            <p className="staff-message staff-message--error" role="alert">
              {error}
            </p>
          ) : null}
          {snapshot.notice ? (
            <p className="staff-message" role="status">
              {snapshot.notice}
            </p>
          ) : null}
          {waiting ? (
            <p role="status" className="staff-secondary">
              Try again in {Math.max(1, Math.ceil((snapshot.retryAt - clock) / 1000))} seconds.
            </p>
          ) : null}
          {phase === 'unconfigured' ? (
            <p>
              This staff address is not configured for sign-in. Contact your administrator for the
              current staff link.
            </p>
          ) : null}
          {phase === 'checking' ? (
            <div className="staff-loading" role="status">
              <span />
              <p>
                {snapshot.busy === 'logout'
                  ? 'Closing your staff session.'
                  : 'Confirming your current session and any pending email verification.'}
              </p>
            </div>
          ) : null}
          {phase === 'redirecting' ? (
            <p>
              Continue on the identity provider’s sign-in page. Your password is verified there.
            </p>
          ) : null}
          {phase === 'signed_out' || phase === 'expired' ? (
            <>
              <p>
                {snapshot.invitationAvailable
                  ? 'Continue to verify your identity, then review the role in this invitation.'
                  : 'Use your invited staff account. After your password is verified, Darve will email you a fresh code.'}
              </p>
              {snapshot.invitationInvalid ? (
                <p className="staff-message" role="status">
                  This invitation link is incomplete or unavailable. Reopen a current invitation to
                  accept it. Existing staff can still sign in.
                </p>
              ) : null}
              <div className="staff-actions">
                <Button
                  disabled={disabled}
                  busy={snapshot.busy === 'sign_in'}
                  onClick={() => void access.signIn()}
                >
                  Continue to staff sign-in
                </Button>
              </div>
            </>
          ) : null}
          {phase === 'email_code_pending' ? (
            <>
              <p>
                Enter the eight-digit code sent to your staff email. Use the most recent message.
              </p>
              <p className="staff-secondary">
                This code expires{' '}
                <time dateTime={snapshot.expiresAt ?? undefined}>{time(snapshot.expiresAt)}</time>.
              </p>
              <form
                className="staff-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = code;
                  setCode('');
                  void access.verify(value);
                }}
              >
                <TextField
                  label="Email verification code"
                  hint="Eight digits, including any leading zero."
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{8}"
                  minLength={8}
                  maxLength={8}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={disabled}
                />
                <Button
                  type="submit"
                  disabled={disabled || !/^\d{8}$/.test(code)}
                  busy={snapshot.busy === 'verify'}
                >
                  Verify code
                </Button>
              </form>
              <div className="staff-actions staff-actions--secondary">
                <Button
                  tone="secondary"
                  disabled={disabled}
                  busy={snapshot.busy === 'resend'}
                  onClick={() => {
                    setCode('');
                    void access.resend();
                  }}
                >
                  Send a new code
                </Button>
                <Button
                  tone="quiet"
                  disabled={disabled}
                  onClick={() => {
                    setCode('');
                    void access.cancel();
                  }}
                >
                  Cancel verification
                </Button>
              </div>
            </>
          ) : null}
          {phase === 'enrollment_pending' ? (
            <>
              <p>Your identity is verified. Review the role before joining this staff workspace.</p>
              <dl className="staff-facts">
                <div>
                  <dt>Invited role</dt>
                  <dd>{roleLabel(snapshot.role)}</dd>
                </div>
                <div>
                  <dt>Accept before</dt>
                  <dd>
                    <time dateTime={snapshot.expiresAt ?? undefined}>
                      {time(snapshot.expiresAt)}
                    </time>
                  </dd>
                </div>
              </dl>
              <form
                className="staff-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void access.accept(confirmed);
                }}
              >
                <label className="staff-confirm">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    disabled={disabled}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I accept this invitation and want to join Darve staff as{' '}
                    {roleLabel(snapshot.role)}.
                  </span>
                </label>
                <Button
                  type="submit"
                  disabled={disabled || !confirmed}
                  busy={snapshot.busy === 'accept'}
                >
                  Accept staff invitation
                </Button>
              </form>
            </>
          ) : null}
          {phase === 'authenticated' ? (
            <>
              <p>
                Your staff session is active. Staff tools are available only when your role and
                current work assignment permit them.
              </p>
              <dl className="staff-facts">
                <div>
                  <dt>Staff role</dt>
                  <dd>{roleLabel(snapshot.role)}</dd>
                </div>
                <div>
                  <dt>Last identity verification</dt>
                  <dd>
                    <time dateTime={snapshot.authenticatedAt ?? undefined}>
                      {time(snapshot.authenticatedAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Session expires</dt>
                  <dd>
                    <time dateTime={snapshot.expiresAt ?? undefined}>
                      {time(snapshot.expiresAt)}
                    </time>
                  </dd>
                </div>
              </dl>
              <p className="staff-secondary">
                Review tools are not available in this workspace yet. Signing in does not mark you
                available for tickets.
              </p>
              {snapshot.permissions.includes('tickets.assigned.read') ? (
                <ActionLink href="/tickets">Open support workspace</ActionLink>
              ) : null}
              <div className="staff-actions">
                <Button
                  tone="secondary"
                  disabled={disabled}
                  busy={snapshot.busy === 'step_up'}
                  onClick={() => void access.stepUp()}
                >
                  Verify identity again
                </Button>
                <Button tone="quiet" disabled={disabled} onClick={() => void access.logout()}>
                  Sign out
                </Button>
              </div>
            </>
          ) : null}
          {phase === 'logout_unconfirmed' ? (
            <>
              <p>
                Your workspace stays closed while sign-out is unconfirmed. Retry sign-out or check
                whether the session has ended.
              </p>
              <div className="staff-actions">
                <Button
                  disabled={disabled}
                  busy={snapshot.busy === 'logout'}
                  onClick={() => void access.logout()}
                >
                  Retry sign-out
                </Button>
              </div>
            </>
          ) : null}
          {phase === 'unavailable' ? (
            <p>Your workspace is closed until current staff access can be confirmed.</p>
          ) : null}
          {!['unconfigured', 'checking', 'redirecting'].includes(phase) ? (
            <div className="staff-refresh">
              <Button tone="quiet" disabled={disabled} onClick={() => void access.inspect()}>
                Check staff access
              </Button>
            </div>
          ) : null}
        </section>
        <aside className="staff-guide" aria-label="Staff sign-in steps">
          <h2>Staff access, step by step</h2>
          <ol>
            <li aria-current={['signed_out', 'expired'].includes(phase) ? 'step' : undefined}>
              <strong>Verify your identity</strong>
              <p>Sign in with your staff account and password.</p>
            </li>
            <li aria-current={phase === 'email_code_pending' ? 'step' : undefined}>
              <strong>Confirm your email code</strong>
              <p>Use the fresh code sent by Darve.</p>
            </li>
            <li
              aria-current={
                ['enrollment_pending', 'authenticated'].includes(phase) ? 'step' : undefined
              }
            >
              <strong>Open your staff session</strong>
              <p>New staff review and accept their invited role first.</p>
            </li>
          </ol>
          <p className="staff-secondary">Staff access is separate from your creator account.</p>
        </aside>
      </main>
      <footer className="staff-footer">Darve · Staff workspace</footer>
    </div>
  );
}
export function StaffAccessScreen({ access }: { access: StaffAccess }) {
  const snapshot = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  return (
    <QueryClientProvider key={snapshot.scope.id} client={snapshot.scope.queryClient}>
      <StaffScreen key={snapshot.scope.id} access={access} snapshot={snapshot} />
    </QueryClientProvider>
  );
}
