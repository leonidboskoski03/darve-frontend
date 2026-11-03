import { staffEnvironment } from '@/services/config/index';
import { mountStaffAccess } from './staff-bootstrap';

const dispose = mountStaffAccess(staffEnvironment);
if (import.meta.hot) import.meta.hot.dispose(dispose);
