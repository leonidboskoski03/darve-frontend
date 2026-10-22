import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export function Component() {
  useEffect(() => {
    document.title = 'Page not found — Darve';
  }, []);
  return (
    <section className="message-page">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>This address does not have a page.</p>
      <Link className="text-link" to="/">
        Return to Darve
      </Link>
    </section>
  );
}
