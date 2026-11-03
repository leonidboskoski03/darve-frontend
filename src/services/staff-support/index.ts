export {
  createStaffSupportClient,
  StaffSupportError,
  staffSupportUncertain,
  type StaffSupportClient,
  type StaffTicket,
  type QueueItem,
  type StaffMessage,
  type Availability,
  type StaffAttempt,
} from './client';
export { subscribeStaffSupport, type StaffSupportStreamPhase } from './subscription';
