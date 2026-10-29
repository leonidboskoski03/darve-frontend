import { ReviewError } from './client';
export function reviewMessage(error: unknown) {
  if (!(error instanceof ReviewError)) return 'Review is unavailable. Refresh before continuing.';
  const { code, status, category } = error.problem;
  const messages: Record<string, string> = {
    INVALID_REVIEW_INPUT: 'Enter an exact positive amount and a whole funding duration in seconds.',
    INVALID_TERMS:
      'The server does not allow these terms. Review the goal, currency and duration before trying again.',
    POLICY_UNAVAILABLE:
      'Challenge terms are not configured on the server. Acceptance is unavailable.',
    PAYMENT_SETUP_REQUIRED: 'A ready receiving account is required before accepting a challenge.',
    INPUT_RESTRICTED: 'These source ideas are restricted and cannot be used.',
    RESULT_UNAVAILABLE: 'The published result is unavailable. Refresh before continuing.',
    ROUND_ALREADY_ACCEPTED:
      'An idea from this round has already been accepted. Refresh to view it.',
    STALE_VERSION: 'The result or idea changed. Refresh and review it again before another action.',
    IDEMPOTENCY_CONFLICT:
      'This request identity does not match its original terms. No new request was sent.',
    CONTEXT_CHANGED: 'The original stream changed. Check its status before another acceptance.',
  };
  if (messages[code]) return messages[code];
  if (status === 404) return 'This round, idea or challenge is unavailable for your account.';
  if (status === 409)
    return 'The result changed. Refresh and review it again before another action.';
  if (status === 403 || status === 401 || category === 'authority')
    return 'Check your session, current account terms and permissions before continuing.';
  if (status === 429) return 'Too many requests. Wait before refreshing.';
  return 'The result could not be confirmed. Check its status before another action.';
}
