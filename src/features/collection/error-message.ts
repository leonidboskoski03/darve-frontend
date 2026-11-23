import { CollectionError } from '@/services/collection/index';
export function collectionErrorMessage(error: unknown) {
  if (!(error instanceof CollectionError))
    return 'This information could not be checked. Refresh to try again.';
  const { code, status, category } = error.problem;
  const messages: Record<string, string> = {
    PAYMENT_SETUP_REQUIRED:
      'Connect a ready receiving account before collecting. Payment setup is required by the server.',
    COLLECTION_ALREADY_ACTIVE:
      'Your account already has an active collection. Check the current round before starting again.',
    TERMS_REQUIRED:
      'Your account terms need attention. Review the current account terms before continuing.',
    PERMISSION_REQUIRED:
      'This account needs chat-reading permission. Review its connection permissions.',
    REAUTHORIZATION_REQUIRED: 'Reconnect this account before collecting.',
    CONTEXT_CHANGED: 'The selected live stream changed. Refresh streams and select it again.',
    ROUND_NOT_READY:
      'This live stream is not ready. Refresh its current status before trying again.',
    ANALYSIS_RETRY_WINDOW_PASSED: 'The 30-minute analysis retry window has closed.',
    ANALYSIS_RETRY_LIMIT_REACHED: 'This round has used both analysis retries.',
    ANALYSIS_RETRY_BUDGET_EXHAUSTED: 'The analysis budget has been reached.',
    ANALYSIS_RETRY_NOT_FAILED: 'Analysis is no longer in a retryable state.',
    VERSION_CONFLICT:
      'The collection changed. Review its refreshed status before confirming again.',
  };
  if (messages[code]) return messages[code];
  if (category === 'configuration') return 'Choose valid collection settings before continuing.';
  if (category === 'authority' || status === 401)
    return 'Darve could not authorize this collection action.';
  if (status === 404) return 'This collection or stream could not be found for your account.';
  if (status === 403)
    return 'The server could not authorize this action. Check your session and permissions.';
  if (status === 409)
    return 'The current collection or stream changed. Refresh before another deliberate action.';
  if (status === 429) return 'Too many requests. Wait before checking again.';
  if (category === 'protocol')
    return 'The server returned an unsupported response. No change can be confirmed.';
  return 'The request could not be confirmed. Check the current state before trying again.';
}
