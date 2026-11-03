import { mountStaffAccess } from '../staff-bootstrap';

// Isolated synthetic entry, excluded from both product builds. No real staff credentials.
const query = new URLSearchParams(window.location.search);
const path = query.get('view') === 'enrol' ? '/staff/enrol' : '/';
window.history.replaceState(null, '', path + window.location.hash);
const dispose = mountStaffAccess({
  appEnv: 'local',
  apiOrigin: 'http://127.0.0.1:3320',
  authorizationEndpoint: 'http://127.0.0.1:3321/authorize',
});
if (import.meta.hot) import.meta.hot.dispose(dispose);
