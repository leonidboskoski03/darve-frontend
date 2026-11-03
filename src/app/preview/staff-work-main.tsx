import { mountStaffAccess } from '../staff-bootstrap';
const query = new URLSearchParams(window.location.search);
const id = query.get('ticketId');
window.history.replaceState(null, '', id ? '/tickets/' + encodeURIComponent(id) : '/tickets');
mountStaffAccess({
  appEnv: 'local',
  apiOrigin: 'http://127.0.0.1:3320',
  authorizationEndpoint: 'http://127.0.0.1:3321/authorize',
});
