import { useEffect, useState } from 'react';
import {
  ReceivingError,
  receivingUncertain,
  type StripeReceiving,
  type PayPalReceiving,
  type createReceivingClient,
} from '@/services/receiving/index';

export type Provider = 'stripe' | 'paypal';
export type Flow = Provider | 'stripeExisting';
export type Receiving = StripeReceiving | PayPalReceiving;
export type Client = ReturnType<typeof createReceivingClient>;
export const providerName = { stripe: 'Stripe', paypal: 'PayPal' } as const;
export const flowProvider = (flow: Flow): Provider => (flow === 'paypal' ? 'paypal' : 'stripe');
export const statusText: Record<Receiving['data']['state'], [string, string]> = {
  unconfigured: [
    'Setup unavailable',
    'This environment needs provider configuration before you can connect an account.',
  ],
  not_connected: ['Not connected', 'Choose a setup option to connect a receiving account.'],
  pending: ['Setup pending', 'Finish the provider steps, then verify receiving here.'],
  reconciliation_required: [
    'Needs reconciliation',
    'The provider result needs to be reconciled. Check current status before taking another setup action.',
  ],
  restricted: ['Restricted', 'The provider has not confirmed all requirements for receiving.'],
  ready: ['Receiving verified', 'The provider confirmed receiving in the test environment.'],
  unavailable: [
    'Verification unavailable',
    'Current receiving capability could not be confirmed. Verify again before relying on it.',
  ],
  revoked: ['Disconnected', 'Darve no longer uses this receiving connection.'],
};

export function receivingMessage(error: unknown, setup = false) {
  if (error instanceof ReceivingError) {
    if (error.problem.code === 'STALE_VERSION' || error.problem.code === 'CONFLICT')
      return 'The connection or setup has changed. Check current status and review your next action.';
    if (error.problem.code === 'RECONCILIATION_REQUIRED')
      return 'The provider result needs reconciliation. Check current status before proceeding.';
    if (error.problem.code === 'AUTHORITY_CHANGED' || error.problem.status === 401)
      return 'Your session changed. Sign in again to manage receiving.';
    if (error.problem.status === 403) return 'Check your session and current account terms.';
    if (error.problem.status === 429) return 'Too many requests. Wait before trying again.';
  }
  if (receivingUncertain(error))
    return setup
      ? 'Setup could not be confirmed. Check current status or retry this same reviewed request.'
      : 'The result could not be confirmed. Check current status before repeating the action.';
  return 'Receiving information could not be confirmed. Check current status and try again.';
}

export function useExpired(deadline: number | null) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setTimeout(() => setElapsed(deadline), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline]);
  return deadline !== null && deadline === elapsed;
}
