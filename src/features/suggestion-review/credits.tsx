import { Disclosure } from '@/design-system/disclosure';
import type { Suggestion } from '@/services/suggestions/index';
export function Credits({ item }: { item: Suggestion }) {
  return (
    <Disclosure
      className="review-credits"
      label={`All ${item.authors.length} author credits · ${item.sourceSubmissionIds.length} source submissions`}
    >
      {() => (
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
          <Disclosure label="Full source membership">
            <ul>
              {item.sourceSubmissionIds.map((id, i) => (
                <li key={`${id}:${i}`}>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
          </Disclosure>
          <p className="review-muted">
            Original message links are not available for these sources.
          </p>
        </>
      )}
    </Disclosure>
  );
}
