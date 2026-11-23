import { useState } from 'react';
import { Button } from '@/design-system/button';
import type { ChallengeDto } from '@/services/contracts/index';
import { publicPaymentLink } from '@/services/reporting/index';

export function PublicChallengeActions({ challenge }: { challenge: ChallengeDto }) {
  const [notice, setNotice] = useState('');
  const link = publicPaymentLink(challenge);
  if (!link) return null;
  const copy = async (value: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(confirmation);
    } catch {
      setNotice('Clipboard access is unavailable. Open the public page to copy its address.');
    }
  };
  return (
    <div className="report-actions">
      <a href={link.path}>Open public page</a>
      <Button tone="secondary" onClick={() => void copy(link.shareUrl, 'Payment link copied.')}>
        Copy payment link
      </Button>
      <Button
        tone="quiet"
        onClick={() => void copy('Support the challenge: ' + link.shareUrl, 'Chat message copied.')}
      >
        Copy chat message with link
      </Button>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
