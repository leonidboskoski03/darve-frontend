import { SupportError, type SupportTicket } from '@/services/support/index';
export const categoryLabels = { account: 'Account', challenge: 'Challenge', stream: 'Stream' };
export const statusLabels = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_for_streamer: 'Waiting for you',
  resolved: 'Resolved',
};
export const date = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
export const ticketLabel = (ticket: SupportTicket) =>
  `${categoryLabels[ticket.category]} · ${ticket.id.slice(0, 8)}`;
export function errorCopy(error: unknown) {
  if (!(error instanceof SupportError)) return 'Support is unavailable. Try refreshing this view.';
  if (error.problem.status === 401 || error.problem.category === 'authority')
    return 'Your session changed. Sign in again to continue.';
  if (error.problem.status === 403 || error.problem.status === 404)
    return 'This support conversation is unavailable to your account.';
  if (error.problem.status === 409)
    return 'The conversation changed or its page expired. Refresh and review the current information.';
  if (error.problem.status === 429)
    return 'Support requests are temporarily limited. Wait before trying again.';
  if (error.problem.status === 400 || error.problem.category === 'configuration')
    return 'Check your message and context. The server may apply a shorter message limit or reject an unavailable resource.';
  return 'Support is unavailable. No change has been confirmed.';
}
