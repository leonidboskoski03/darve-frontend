import { StaffAdminError } from '@/services/staff-admin/index';
export function adminError(error: unknown) {
  if (!(error instanceof StaffAdminError))
    return 'Staff information is unavailable. Refresh to check current access.';
  if (error.problem.code === 'REAUTHENTICATION_REQUIRED')
    return 'Verify your identity again, then reload current facts and review a new action. Nothing is replayed automatically.';
  if (error.problem.status === 409)
    return 'This record changed or its page expired. Reload current facts and review the action again.';
  if ([403, 404].includes(error.problem.status ?? 0))
    return 'This record or action is unavailable with your current staff access. Private information has been cleared.';
  if (error.problem.status === 429)
    return 'Requests are temporarily limited. Wait before trying again.';
  if (error.problem.category === 'configuration')
    return 'Check the complete target ID, identity, reason and current record before continuing.';
  return 'The result could not be confirmed. Check current information before preparing another action.';
}
