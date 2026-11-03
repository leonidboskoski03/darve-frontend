import { StaffSupportError } from '@/services/staff-support/index';
export function staffError(error: unknown) {
  if (!(error instanceof StaffSupportError))
    return 'Staff support is unavailable. Refresh to check current access.';
  if (error.problem.status === 409)
    return 'This work changed or its page expired. Refresh and review the current assignment before preparing another action.';
  if ([403, 404].includes(error.problem.status ?? 0))
    return 'This ticket or action is not available with your current staff access.';
  if (error.problem.status === 429)
    return 'Requests are temporarily limited. Wait before trying again.';
  if (error.problem.category === 'configuration')
    return 'Check the message, reason and complete resource ID before continuing.';
  return 'The request could not be confirmed. Refresh current information before preparing a new action.';
}
