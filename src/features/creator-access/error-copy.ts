import { CreatorAccessError } from '@/services/creator-access/index';

export function accessErrorMessage(error: unknown) {
  if (!(error instanceof CreatorAccessError))
    return 'This request could not be confirmed. Try again when the connection is available.';
  const problem = error.problem;
  if (problem.code === 'PROVIDER_UNAVAILABLE')
    return 'This provider is not configured or is unavailable on this server. Choose another provider or try later.';
  if (problem.code === 'AUTHORIZATION_IN_PROGRESS')
    return 'Another authorization is already in progress.';
  if (problem.category === 'network' || problem.category === 'timeout')
    return 'The request could not be confirmed. Check the current account state before trying again.';
  if (problem.status === 403)
    return 'The request could not be verified. Check your session and try again.';
  if (problem.status === 409)
    return 'The account or terms changed. Refresh the current information and confirm again.';
  if (problem.status === 404)
    return 'This account information could not be found. Refresh your account state.';
  if (problem.status === 429) return 'Too many requests. Wait before trying again.';
  if (problem.status === 503)
    return 'This service is unavailable or is not configured on this server. Try later.';
  if (problem.category === 'protocol')
    return 'The server returned an unsupported response. No change has been confirmed.';
  return 'This request could not be confirmed. Check your session and try again.';
}
