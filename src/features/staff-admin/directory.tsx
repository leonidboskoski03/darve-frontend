import { useState } from 'react';
import type { StaffAdminClient, StaffMember } from '@/services/staff-admin/index';
import { TextField } from '@/design-system/text-field';
import type { AdminCommand } from './use-command';
import { ReviewedAction } from './reviewed-action';
export function MemberActions({
  client,
  member,
  command,
}: {
  client: StaffAdminClient;
  member: StaffMember;
  command: AdminCommand;
}) {
  return (
    <>
      {member.active ? (
        <>
          <ReviewedAction
            title="Change staff role"
            label="Confirm staff role change"
            summary={
              'Change ' +
              member.id +
              ' from ' +
              member.role +
              ' to ' +
              (member.role === 'SUPPORT' ? 'OWNER_ADMIN' : 'SUPPORT') +
              ' at revision ' +
              member.revision +
              '. Existing sessions and affected invitations are revoked. The server protects the last active owner administrator.'
            }
            command={command}
            prepare={(reason) =>
              client.prepareMember(
                member,
                member.role === 'SUPPORT' ? 'OWNER_ADMIN' : 'SUPPORT',
                reason,
              )
            }
          />
          <ReviewedAction
            title="Revoke staff membership"
            label="Confirm staff revocation"
            summary={
              'Revoke ' +
              member.id +
              ' at revision ' +
              member.revision +
              '. Existing sessions and affected invitations are revoked. The server protects the last active owner administrator.'
            }
            command={command}
            prepare={(reason) => client.prepareMember(member, 'revoke', reason)}
          />
        </>
      ) : (
        <p>This membership is inactive.</p>
      )}
    </>
  );
}
export function InvitationActions({
  client,
  command,
}: {
  client: StaffAdminClient;
  command: AdminCommand;
}) {
  const [kind, setKind] = useState<'email' | 'subject'>('email'),
    [identity, setIdentity] = useState(''),
    [role, setRole] = useState<StaffMember['role']>('SUPPORT'),
    [revoke, setRevoke] = useState('');
  return (
    <section className="staff-admin-invitations">
      <h2>Invitations</h2>
      <p>
        Invitation creation returns a private one-use link. Share it through your approved channel;
        this action does not send email. Pending invitations have no listing endpoint, so revocation
        requires a known invitation ID.
      </p>
      <label htmlFor="staff-invite-kind">Identity binding</label>
      <select
        id="staff-invite-kind"
        className="ds-input"
        disabled={command.blocked}
        value={kind}
        onChange={(event) => {
          setKind(event.target.value === 'subject' ? 'subject' : 'email');
          setIdentity('');
        }}
      >
        <option value="email">Verified email</option>
        <option value="subject">Immutable provider subject</option>
      </select>
      <TextField
        label="Invited identity"
        value={identity}
        maxLength={kind === 'email' ? 254 : 255}
        disabled={command.blocked}
        onChange={(event) => setIdentity(event.target.value)}
      />
      <label htmlFor="staff-invite-role">Invited role</label>
      <select
        id="staff-invite-role"
        className="ds-input"
        disabled={command.blocked}
        value={role}
        onChange={(event) =>
          setRole(event.target.value === 'OWNER_ADMIN' ? 'OWNER_ADMIN' : 'SUPPORT')
        }
      >
        <option value="SUPPORT">Support</option>
        <option value="OWNER_ADMIN">Owner administrator</option>
      </select>
      <ReviewedAction
        key={kind + identity + role}
        title="Create staff invitation"
        label="Confirm invitation creation"
        summary={
          'Invite ' +
          (identity || '(enter an identity)') +
          ' using ' +
          kind +
          ' binding as ' +
          role +
          '. Explicit acceptance is required before membership is active.'
        }
        disabled={!identity.trim()}
        command={command}
        prepare={(reason) => client.prepareInvite(kind, identity.trim(), role, reason)}
      />
      <TextField
        label="Invitation ID to revoke"
        value={revoke}
        disabled={command.blocked}
        onChange={(event) => setRevoke(event.target.value)}
      />
      <ReviewedAction
        key={revoke}
        title="Revoke invitation"
        label="Confirm invitation revocation"
        summary={
          'Revoke the known pending invitation ' +
          (revoke || '(enter an ID)') +
          '. This does not revoke an existing staff membership.'
        }
        disabled={!revoke.trim()}
        command={command}
        prepare={(reason) => client.prepareRevokeInvitation(revoke.trim(), reason)}
      />
    </section>
  );
}
