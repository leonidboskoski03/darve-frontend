import type { ReactNode } from 'react';

function inlineText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (!token) continue;
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Lightweight markdown renderer for the approved public legal documents. */
export function DocumentBody({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h4 key={key++} className="legal-doc__h3">
          {inlineText(trimmed.slice(4))}
        </h4>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push(
        <h3 key={key++} className="legal-doc__h2">
          {inlineText(trimmed.slice(3))}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const items: ReactNode[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('- ')) {
        items.push(<li key={key++}>{inlineText((lines[i] ?? '').trim().slice(2))}</li>);
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="legal-doc__list">
          {items}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] ?? '').trim();
      if (!next || next.startsWith('#') || next.startsWith('- ')) break;
      paragraph.push(next);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="legal-doc__p">
        {inlineText(paragraph.join(' '))}
      </p>,
    );
  }

  return <div className="legal-doc__body">{blocks}</div>;
}
