import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PublishedFaq, PublishedPolicy } from '@/features/public-policies/index';

export function Component() {
  const { pathname } = useLocation();
  const kind = pathname === '/privacy' ? 'privacy' : pathname === '/safety' ? 'safety' : 'terms';
  const faq = pathname === '/faq';
  useEffect(() => {
    document.title =
      (faq
        ? 'Frequently Asked Questions'
        : kind === 'terms'
          ? 'Terms of Service'
          : kind === 'privacy'
            ? 'Privacy Policy'
            : 'Safety Guidelines') + ' — Darve';
  }, [kind, faq]);
  return faq ? <PublishedFaq /> : <PublishedPolicy kind={kind} />;
}
