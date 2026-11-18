import { createElement, useState, type ReactNode } from 'react';

import { Disclosure } from '@/design-system/disclosure';
import published from './published.json';
import './published-policy.css';

type ContentNode = { text?: string; tag?: string; href?: string; children?: ContentNode[] };
const elements = new Set([
  'p',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'a',
  'br',
  'code',
  'blockquote',
]);

function content(nodes: ContentNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.text !== undefined) return node.text;
    const tag = node.tag && elements.has(node.tag) ? node.tag : 'span';
    return createElement(
      tag,
      { key: index, ...(tag === 'a' ? { href: node.href } : {}) },
      tag === 'br' ? undefined : content(node.children ?? []),
    );
  });
}

export function PublishedPolicy({ kind }: { kind: 'terms' | 'privacy' | 'safety' }) {
  const policy = published[kind];
  return (
    <section className="published-policy">
      <header className="published-policy__header">
        <div>
          <h1>{policy.title}</h1>
          <p>Effective and last updated {policy.updated}</p>
        </div>
        <a href="/welcome">Back to home</a>
      </header>
      <p className="published-policy__source">
        Published darve.gg policy. <a href={policy.source}>View original</a>
      </p>
      <article className="published-policy__document">{content(policy.content)}</article>
    </section>
  );
}

export function PublishedFaq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="published-policy published-policy--faq">
      <header className="published-policy__header">
        <h1>{published.faq.title}</h1>
        <a href="/welcome">Back to home</a>
      </header>
      <p className="published-policy__source">
        Published FAQ from darve.gg. <a href={published.faq.source}>View original</a>
        {' · '}
        <a href="/help">Help with the rebuilt app</a>
      </p>
      <div className="published-policy__questions">
        {published.faq.items.map((item, index) => (
          <Disclosure
            key={item.question}
            heading="h2"
            label={item.question}
            expanded={open === index}
            onExpandedChange={(expanded) => setOpen(expanded ? index : null)}
          >
            <div className="published-policy__answer">{content(item.answer)}</div>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}
