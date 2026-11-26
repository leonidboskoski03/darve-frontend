import { useEffect } from 'react';
import { Brand } from '@/design-system/brand';
import { DocumentBody } from './document-body';
import { LEGAL_TABS, type LegalDocument } from './documents';
import './legal-page.css';

/** Concept-style public legal document shell. Presentation only — not account acceptance. */
export function LegalPage({ document: doc }: { document: LegalDocument }) {
  useEffect(() => {
    document.title = `${doc.tabLabel} — Darve`;
    window.scrollTo(0, 0);
  }, [doc]);

  return (
    <div className="legal-page">
      <div className="legal-page__shell">
        <nav className="legal-page__top" aria-label="Legal page">
          <a className="legal-page__brand" href="/welcome" aria-label="Darve home">
            <Brand wordmark />
          </a>
          <a className="legal-page__back" href="/welcome">
            <span aria-hidden="true">← </span>BACK TO DARVE
          </a>
        </nav>

        <header className="legal-page__header">
          <p className="legal-page__crumb">
            <a href="/welcome">DARVE</a>
            <span aria-hidden="true"> / </span>
            <span>LEGAL</span>
          </p>
          <h1>{doc.title}</h1>
          <p className="legal-page__tagline">{doc.tagline}</p>
          <p className="legal-page__meta">
            <span>EFFECTIVE {doc.effective}</span>
            <span>LAST UPDATED {doc.updated}</span>
          </p>
        </header>

        <nav className="legal-page__tabs" aria-label="Legal documents">
          {LEGAL_TABS.map((tab) => {
            const active = tab.id === doc.id;
            return (
              <a
                key={tab.id}
                href={tab.path}
                className={active ? 'is-active' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                {tab.tabLabel}
              </a>
            );
          })}
        </nav>

        <article className="legal-page__panel">
          <div className="legal-page__panel-bar">
            <span>{doc.docLabel}</span>
            <a href={doc.originalHref} rel="noopener noreferrer" target="_blank">
              OPEN ORIGINAL <span aria-hidden="true">&gt;</span>
            </a>
          </div>
          <div className="legal-page__panel-body">
            <h2 className="legal-doc__title">{doc.docHeading}</h2>
            <p className="legal-doc__dates">
              Effective Date: {formatLong(doc.effective)}
              <br />
              Last Updated: {formatLong(doc.updated)}
            </p>
            <DocumentBody markdown={doc.markdown} />
          </div>
        </article>
      </div>
    </div>
  );
}

function formatLong(value: string) {
  const [month, day, year] = value.split(' ');
  if (!month || !day || !year) return value;
  const titled = month.charAt(0) + month.slice(1).toLowerCase();
  return `${titled} ${day.replace(',', '')}, ${year}`;
}
