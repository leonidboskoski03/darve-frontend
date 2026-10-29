import { useState } from 'react';
import type { Suggestion } from '@/services/suggestions/index';
export function Credits({ item }: { item: Suggestion }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="review-credits" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        All {item.authors.length} author credits · {item.sourceSubmissionIds.length} source
        submissions
      </summary>
      {open && (
        <>
          <ul>
            {item.authors.map((author, index) => (
              <li key={`${author.provider}:${author.providerAuthorId}:${index}`}>
                <strong>{author.displayName ?? 'Unnamed viewer'}</strong> · {author.provider}
                <span className="review-muted"> Account {author.providerAuthorId}</span>
                <ul>
                  {author.submissionIds.map((id, i) => (
                    <li key={`${id}:${i}`}>
                      <code>{id}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <details>
            <summary>Full source membership</summary>
            <ul>
              {item.sourceSubmissionIds.map((id, i) => (
                <li key={`${id}:${i}`}>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
          </details>
          <p className="review-muted">
            Original message links are not available for these sources.
          </p>
        </>
      )}
    </details>
  );
}
