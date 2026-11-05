import { mountStaffAccess } from '../staff-bootstrap';
window.history.replaceState(null, '', '/coins' + window.location.search);
mountStaffAccess({
  appEnv: 'local',
  apiOrigin: 'http://127.0.0.1:3320',
  authorizationEndpoint: 'http://127.0.0.1:3321/authorize',
});
